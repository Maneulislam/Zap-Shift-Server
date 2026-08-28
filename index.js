const express = require('express');
const cors = require('cors');
const app = express()
const dotenv = require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const crypto = require("crypto");

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
        const parcelsCollections = db.collection('parcels');
        const paymentCollection = db.collection('payment');


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


        // Payment status

        app.patch('/payment-success', async (req, res) => {
            const sessionId = req.query.session_id;
            const trackingId = generateTrackingId();

            const session = await stripe.checkout.sessions.retrieve(sessionId);
            console.log("Session retrieve", session);

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
                    paidAt: new Date()
                }

                if (session.payment_status === 'paid') {
                    const resultPayment = await paymentCollection.insertOne(payment);

                    res.send({ success: true, trackingId: trackingId, transactionId: session.payment_intent, modifyParcel: result, paymentInfo: resultPayment })
                }



            }

            res.send({ success: false })


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