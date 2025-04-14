const { MongoClient } = require('mongodb');

// MongoDB connection URI
const uri = 'mongodb://127.0.0.1:27017';
const client = new MongoClient(uri);

// Connect to MongoDB
let db;
async function connectDB() {
    try {
        await client.connect();
        db = client.db('Smartscheme'); // Use the Smartscheme database
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
    }
}

// Get the database instance
function getDB() {
    return db;
}

module.exports = { connectDB, getDB };