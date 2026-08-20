const express = require('express');
const cors = require('cors');
const app = express()
const dotenv = require('dotenv').config()
const port = process.env.PORT || 3000


//Middleware
app.use(express.json());
app.use(cors());


app.get('/', (req, res) => {
    res.send('Zap is Shifting...')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})