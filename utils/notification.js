const { getDB } = require("../db");

// Function to send notifications
async function sendNotification(userID,scholarshipId, message, type) {
    const db = getDB();
    const notificationsCollection = db.collection("notifications");
    console.log("sending notification");
    await notificationsCollection.insertOne({
        user_id: userID,
        scholarshipID:scholarshipId,
        message: message,
        type: type,
        isRead: false,
        timestamp: new Date(),
    });
}

async function getEligibleUsersForScholarship(scholarship) {
    const db = getDB();
    const usersCollection = db.collection("user_details");
    console.log("Function reaches getEligibleUserForScholarship");
    // Build the query based on scholarship criteria
    const query = {
        annual_income: { $lte: scholarship.income_limit } // Check income limit
    };

    // Check course type eligibility
    if (scholarship.course_type && scholarship.course_type.length > 0) {
        query.course_type = { $in: scholarship.course_type }; // Match any of the course types
    }

    // Check category eligibility
    if (scholarship.category && scholarship.category.length > 0) {
        query.category = { $in: scholarship.category }; // Match any of the categories
    }

    // Check domicile eligibility
    if (scholarship.domicile && scholarship.domicile.length > 0) {
        query.domicile_state = { $in: scholarship.domicile }; // Match any of the domiciles
    }

    // Check admission type eligibility
    if (scholarship.admission_type) {
        query.admission_type = scholarship.admission_type; // Match admission type
    }

    // Check gender eligibility
    if (scholarship.gender && scholarship.gender.length > 0) {
        query.gender = { $in: scholarship.gender }; // Match any of the genders
    }
    console.log(query);
    try {
        // Fetch eligible users
        const eligibleUsers = await usersCollection.find(query).toArray();
        console.log(eligibleUsers);
        return eligibleUsers;

    } catch (error) {
        console.error("Error fetching eligible users:", error);
        throw new Error("Could not fetch eligible users");
    }
}


// Function to notify users about a new scholarship
async function notifyEligibleUsers(newScholarship) {
    console.log("Notifying eligible users for scholarship:", newScholarship);
    // Get eligible users for the scholarship
    const eligibleUsers = await getEligibleUsersForScholarship(newScholarship);
    const scholarshipId = newScholarship.scholarshipID;
    // Iterate over the eligible users
    for (const user of eligibleUsers) {
        try {
            const message = `Dear ${user.first_name},\n\nYou are eligible for the ${newScholarship.name} scholarship. Please check your profile for more details.`;
            const type = "scholarship_notification"; // Define the type of notification

            // Send notification to the user
            await sendNotification(user._id,scholarshipId, message, type);
            console.log(`Notification sent to user ID ${user._id} for scholarship: ${newScholarship.name}`);
        } catch (error) {
            console.error(`Error sending notification to user ID ${user._id}:`, error);
        }
    }
}

module.exports = { sendNotification, notifyEligibleUsers,getEligibleUsersForScholarship };
