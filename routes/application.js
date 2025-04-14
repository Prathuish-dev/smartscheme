const express = require("express");
const { getDB } = require("../db");
const { sendNotification } = require("../utils/notifications");
const router = express.Router();

// Verify scholarship application
router.post("/verify-application", async (req, res) => {
    try {
        const db = getDB();
        const applicationsCollection = db.collection("applications");

        const { applicationID, userID } = req.body;

        // Update application status
        await applicationsCollection.updateOne(
            { _id: applicationID },
            { $set: { status: "Verified" } }
        );

        // Send notification to user
        await sendNotification(userID, "Your scholarship application has been verified!", "verification");

        res.json({ message: "Application verified and notification sent" });
    } catch (error) {
        console.error("Error verifying application:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;
