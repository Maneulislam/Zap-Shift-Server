const express = require('express');
const cors = require('cors');
const app = express()
const dotenv = require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000
const stripe = require('stripe')(process.env.STRIPE_SECRET);




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
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        // Provide the exact Price ID (for example, price_1234) of the product you want to sell
                        price_data: {
                            currency: "USD",
                            unit_amount: '1500',
                            product_data: {
                                name: paymentInfo.productName
                            }
                        },
                        quantity: 1,
                    },
                ],
                customer_email: paymentInfo.senderEmail,
                mode: 'payment',
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
                // Provide a name (for example, hosted_web_0001) to label this Checkout integration and measure its conversion independently
                integration_identifier: '{{INTEGRATION_ID}}',
            });

            res.redirect(303, session.url);
        });




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