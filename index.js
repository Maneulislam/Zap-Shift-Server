const express = require('express');
const cors = require('cors');
const app = express()
const dotenv = require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const crypto = require("crypto");
const { initializeApp, cert } = require("firebase-admin/app");

const serviceAccount = require("./zap-shift-firebase-adminsdk.json");
const { getAuth } = require('firebase-admin/auth');

initializeApp({
    credential: cert(serviceAccount)
});



const generateTrackingId = () => {
    const date = new Date();

    const datePart = date.toISOString()
        .slice(0, 10)
        .replace(/-/g, "");

    const randomPart = crypto
        .randomBytes(4)
        .toString("hex")
        .toUpperCase();

    return `PCL-${datePart}-${randomPart}`;
};




//Middleware
app.use(express.json());
app.use(cors());

const verifyFbToken = async (req, res, next) => {

    const token = req.headers.authorization;

    if (!token) {
        return res.status(401).send({ message: 'Unauthorized access' });
    }

    try {
        const tokenId = token.split(' ')[1];

        const decoded = await getAuth().verifyIdToken(tokenId);

        console.log("decoded token", decoded);

        req.decoded_email = decoded.email;

        next();
    }
    catch (error) {
        console.log(error);

        return res.status(401).send({ message: 'Unauthorized access' });
    }
};


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@simple-crud-server.awx9wzo.mongodb.net/?appName=simple-crud-server`;


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db('zap_shift_db');

        const userCollection = db.collection('users')
        const parcelsCollections = db.collection('parcels');
        const paymentCollection = db.collection('payment');
        const riderCollection = db.collection('riders');




        // User related apis

        app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = 'user';
            user.createdAt = new Date();
            const email = user.email;

            const userExists = await userCollection.findOne({ email })

            if (userExists) {
                return res.send({ message: 'user already exists' });
            }

            const result = await userCollection.insertOne(user);
            res.send(result);
        })


        // Parcel API
        app.get('/parcels', async (req, res) => {

            const query = {};
            const { email } = req.query;

            if (email) {
                query.senderEmail = email;
            }

            const options = { sort: { createdAt: - 1 } }

            const cursor = parcelsCollections.find(query, options);
            const result = await cursor.toArray();
            res.send(result)

        })

        app.get('/parcels/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await parcelsCollections.findOne(query);
            res.send(result);
        });


        app.post('/parcels', async (req, res) => {
            const parcel = req.body;

            parcel.createdAt = new Date();

            const result = await parcelsCollections.insertOne(parcel);
            res.send(result);
        })


        app.delete('/parcels/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await parcelsCollections.deleteOne(query);
            res.send(result)
        })



        // Stripe payment

        app.post('/create-checkout-session', async (req, res) => {

            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.cost) * 100;

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: "USD",
                            unit_amount: amount,
                            product_data: {
                                name: paymentInfo.parcelName
                            }
                        },
                        quantity: 1,
                    },
                ],
                customer_email: paymentInfo.senderEmail,
                mode: 'payment',
                metadata: {
                    parcelId: paymentInfo.parcelId
                },
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,

            });

            res.send({ url: session.url });
        });


        // Payment success status

        app.patch('/payment-success', async (req, res) => {
            const sessionId = req.query.session_id;
            const trackingId = generateTrackingId();

            const session = await stripe.checkout.sessions.retrieve(sessionId);
            console.log("Session retrieve", session);


            // Duplicate payment off
            const transactionId = session.payment_intent;
            const query = { transactionId: transactionId }

            const existingPayment = await paymentCollection.findOne(query);

            if (existingPayment) {
                return res.send({
                    success: true,
                    message: 'Payment already processed',
                    trackingId: existingPayment.trackingId,
                    transactionId
                });
            }

            if (session.payment_status === 'paid') {
                const id = session.metadata.parcelId;
                const query = { _id: new ObjectId(id) };
                const update = {
                    $set: {
                        paymentStatus: 'paid',
                        trackingId: trackingId,
                    },
                };

                const result = await parcelsCollections.updateOne(query, update);


                const payment = {
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    customerEmail: session.customer_email,
                    parcelId: session.metadata.parcelId,
                    currency: session.currency,
                    parcelName: session.metadata.parcelName,
                    transactionId: session.payment_intent,
                    paymentStatus: session.payment_status,
                    paidAt: new Date(),
                    trackingId: trackingId
                }

                if (session.payment_status === 'paid') {
                    const resultPayment = await paymentCollection.insertOne(payment);

                    res.send({ success: true, trackingId: trackingId, transactionId: session.payment_intent, modifyParcel: result, paymentInfo: resultPayment })
                }



            }

            res.send({ success: false })


        })



        // payment related api

        app.get('/payments', verifyFbToken, async (req, res) => {

            const email = req.query.email;
            const query = {};

            console.log("Headers", req.headers);

            if (email) {
                query.customerEmail = email;

                if (email !== req.decoded_email) {
                    return res.status(403).send({ message: 'Forbidden' });
                }
            }

            const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
            const result = await cursor.toArray();

            res.send(result);
        });


        // riders related apis

        app.post('/riders', async (req, res) => {
            const riders = req.body;
            riders.status = 'pending';
            riders.createdAt = new Date();

            const result = await riderCollection.insertOne(riders);
            res.send(result)
        })


        app.patch('/riders/:id', verifyFbToken, async (req, res) => {
            const status = req.body.status;
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    status: status
                }
            }

            const result = await riderCollection.updateOne(query, updateDoc);
            res.send(result);


        })


        app.get('/riders', async (req, res) => {
            const query = {};

            if (req.query.status) {
                query.status = req.query.status;
            }

            const cursor = riderCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);


        })

        app.delete('/riders/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await riderCollection.deleteOne(query);
            res.send(result);

        })





        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);




app.get('/', (req, res) => {
    res.send('Zap is Shifting...')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})