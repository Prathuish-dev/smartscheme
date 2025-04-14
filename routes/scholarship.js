const express = require("express");
const { getDB } = require("../db");
const { notifyEligibleUsers } = require("../utils/notifications");
const router = express.Router();

// Add a new scholarship
router.post("/add-scholarship", async (req, res) => {
    try {
        const db = getDB();
        const scholarshipsCollection = db.collection("scholarships");

        const newScholarship = req.body;
        await scholarshipsCollection.insertOne(newScholarship);

        // Notify eligible users
        await notifyEligibleUsers(newScholarship);

        res.status(201).json({ message: "Scholarship added and notifications sent" });
    } catch (error) {
        console.error("Error adding scholarship:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;
