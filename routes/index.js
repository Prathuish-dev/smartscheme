const express = require('express');
const router = express.Router();
const multer = require('multer');
const bcrypt = require('bcrypt');
const { getDB } = require('../db');
const sendEmail = require('../mailer');
const { ObjectId } = require('mongodb');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const fetch = require('node-fetch');
const { PDFDocument, StandardFonts, rgb, degrees: pdfLibDegrees } = require('pdf-lib');
const {  notifyEligibleUsers } = require('../utils/notification');

const upload = multer({
    storage: multer.diskStorage({
        destination: function (req, file, cb) {
            const uploadPath = path.join(__dirname, '../uploads');
            fs.mkdirSync(uploadPath, { recursive: true });
            cb(null, uploadPath);
        },
        filename: function (req, file, cb) {
            cb(null, `application_${Date.now()}${path.extname(file.originalname)}`);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
    fileFilter: function (req, file, cb) {
        if (file.mimetype === 'application/pdf' || file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PDF, JPEG, and PNG files are allowed.'));
        }
    }
});

// Home page route
router.get('/', (req, res) => {
    res.render('home');
});

// Login/Sign-Up page route
router.get('/login', (req, res) => {
    res.render('login');
});

router.get('/search', (req, res) => {
    res.render('search');
});

router.get('/admin-login', (req, res) => {
    if (req.session.adminUsername) { // Changed from isAdmin to adminUsername
        return res.redirect('/admin-panel');
    }
    res.render('admin_login');
});

// Handle Admin Login Form Submission
router.post('/admin-login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const db = getDB();
        const adminCollection = db.collection('admin');
        const admin = await adminCollection.findOne({ username });
        if (!admin) {
            return res.status(400).send("Admin not found.");
        }
        if (admin.password !== password) {
            return res.status(400).send("Invalid password.");
        }
        req.session.adminUsername = admin.username;
        res.redirect('/admin-panel');
    } catch (error) {
        console.error("Error during admin login:", error);
        res.status(500).send("An error occurred during admin login.");
    }
});

// Admin Panel Route
router.get('/admin-panel', async (req, res) => {
    if (!req.session.adminUsername) {
        return res.status(401).send("Unauthorized. Please log in as an admin.");
    }
    try {
        const db = getDB();
        
        // Get dashboard stats
        const [totalUsers, totalScholarships, pendingFormsCount, assignedApplications] = await Promise.all([
            db.collection('user_details').countDocuments(),
            db.collection('scholarships').countDocuments(),
            db.collection('applications').countDocuments({ status: 'pending' }),
            db.collection('applications').aggregate([
                { 
                    $match: { 
                        assignedTo: { $exists: true } 
                    } 
                }, // Fixed: Added closing bracket for $match
                { 
                    $lookup: {
                        from: 'scholarships',
                        localField: 'scholarshipID',
                        foreignField: 'scholarshipID',
                        as: 'scholarship'
                    }
                },
                { $unwind: '$scholarship' },
                { $sort: { assignedAt: -1 } },
                { $limit: 50 },
                { 
                    $project: {
                        applicationNo: 1,
                        userId: 1,
                        assignedTo: 1,
                        status: 1,
                        assignedAt: 1,
                        scholarshipName: '$scholarship.name'
                    }
                }
            ]).toArray()
        ]);

        res.render('admin_panel', { 
            totalUsers, 
            totalScholarships, 
            pendingFormsCount,
            assignedApplications,
            helpers: {
                formatDate: function(date) {
                    return date ? new Date(date).toLocaleString('en-IN') : 'N/A';
                }
            }
        });
    } catch (error) {
        console.error("Error fetching admin panel data:", error);
        res.status(500).send("An error occurred while fetching admin panel data.");
    }
});
// Handle Sign-Up Form Submission
router.post('/signup', async (req, res) => {
    const { aadhar, email, password, confirmPassword } = req.body;
    if (!aadhar || !email || !password || !confirmPassword) {
        return res.status(400).send("All fields are required.");
    }
    if (password !== confirmPassword) {
        return res.status(400).send("Passwords do not match.");
    }
    try {
        const db = getDB();
        const usersCollection = db.collection('user_details');
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
            return res.status(400).send("User already exists.");
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        await usersCollection.insertOne({
            aadhar,
            email,
            password: hashedPassword,
            profileCompleted: false,
        });
        const subject = 'Account Creation Successful - Smart Scheme';
        const text = `Dear User,\n\nYour account has been successfully created with the following details:\n\nEmail: ${email}\nAadhar: ${aadhar}\n\nThank you for choosing Smart Scheme!`;
        await sendEmail(email, subject, text);
        req.session.userEmail = email;
        res.redirect('/user-details');
    } catch (error) {
        console.error("Error during sign-up:", error);
        res.status(500).send("An error occurred during sign-up.");
    }
});

// Handle Login Form Submission
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const db = getDB();
        const usersCollection = db.collection('user_details');
        const user = await usersCollection.findOne({ email });
        if (!user) {
            return res.status(400).send("User not found.");
        }
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).send("Invalid password.");
        }
        req.session.userEmail = user.email;
        if (user.profileCompleted) {
            res.redirect('/profile');
        } else {
            res.redirect('/user-details');
        }
    } catch (error) {
        console.error("Error during login:", error);
        res.status(500).send("An error occurred during login.");
    }
});

// User Details Form Route
router.get('/user-details', async (req, res) => {
    try {
        const db = getDB();
        const usersCollection = db.collection('user_details');
        const userEmail = req.session.userEmail;
        if (!userEmail) {
            return res.status(401).send("Unauthorized. Please log in.");
        }
        const user = await usersCollection.findOne({ email: userEmail });
        if (!user) {
            return res.status(404).send("User not found.");
        }
        const courseTypes = [
            "High School", "Higher secondary", "CA/CMA/CS", "Diploma", "+1", "+2", "UG", "PG",
            "NURSING DIPLOMA", "PARAMEDICAL", "Degree", "SSLC", "Diploma Poly", "Prof course"
        ];
        if (user.profileCompleted) {
            user.isMale = user.gender === "Male";
            user.isFemale = user.gender === "Female";
            user.isSC = user.category === "SC";
            user.isST = user.category === "ST";
            user.isOBC = user.category === "OBC";
            user.isMinority = user.category === "Minority";
            user.isGeneral = user.category === "General";
            user.isRomanCatholic = user.caste === "Roman Catholic";
            user.isLatinCatholic = user.caste === "Latin Catholic";
            user.isBrahmins = user.caste === "Brahmins";
            user.isEzhava = user.caste === "Ezhava";
            user.isKoyas = user.caste === "Koyas";
            user.isKerala = user.domicile_state === "Kerala";
            user.isHindu = user.religion === "Hindu";
            user.isMuslim = user.religion === "Muslim";
            user.isChristian = user.religion === "Christian";
            user.isSikh = user.religion === "Sikh";
            user.isBuddhist = user.religion === "Buddhist";
            user.isJain = user.religion === "Jain";
            user.isParsi = user.religion === "Parsi";
            user.isOtherReligion = user.religion === "Other";
            user.isStudentYes = user.is_student === "Yes";
            user.isStudentNo = user.is_student === "No";
            user.isGovInstitute = user.institute_type === "gov";
            user.isGovAidedInstitute = user.institute_type === "gov_aided";
            user.isSelfFinanceInstitute = user.institute_type === "self_finance";
            user.previousScholarshipYes = user.previous_scholarship === "1";
            user.previousScholarshipNo = user.previous_scholarship === "0";
            user.singleGirlChildYes = user.single_girl_child === "1";
            user.singleGirlChildNo = user.single_girl_child === "0";
            user.isMerit = user.admission_type === "merit";
            user.isReservation = user.admission_type === "reservation";
            user.isManagement = user.admission_type === "management";
            user.courseTypeFlags = {};
            if (user.course_type) {
                courseTypes.forEach(course => {
                    user.courseTypeFlags[course] = course === user.course_type;
                });
            }
        }
        res.render('user_details', { user, courseTypes });
    } catch (error) {
        console.error("Error fetching user details:", error);
        res.status(500).send("An error occurred while fetching user details.");
    }
});

// Handle User Profile Submission
router.post('/submit-user-details', async (req, res) => {
    const userProfile = req.body;
    userProfile.annual_income = parseFloat(userProfile.annual_income);
    userProfile.attendance_percentage = parseFloat(userProfile.attendance_percentage);
    userProfile.percentage_or_marks = parseFloat(userProfile.percentage_or_marks);
    userProfile.qualification_exam_score = parseFloat(userProfile.qualification_exam_score);
    const requiredFields = [
        'email', 'first_name', 'last_name', 'gender', 'date_of_birth',
        'category', 'caste', 'domicile_state', 'religion', 'address', 'phone_number',
        'is_student', 'annual_income', 'previous_scholarship', 'single_girl_child',
        'course_type'
    ];
    for (const field of requiredFields) {
        if (!userProfile[field]) {
            return res.status(400).send(`Field "${field}" is required.`);
        }
    }
    try {
        const db = getDB();
        const usersCollection = db.collection('user_details');
        await usersCollection.updateOne(
            { email: userProfile.email },
            { $set: { ...userProfile, profileCompleted: true } },
            { upsert: false }
        );
        res.redirect('/profile');
    } catch (error) {
        console.error("Error updating user profile:", error);
        res.status(500).send("An error occurred while updating the profile.");
    }
});

// Function to fetch eligible scholarships
async function getEligibleScholarships(user) {
    const db = getDB();
    const scholarshipsCollection = db.collection('scholarships');
    const scholarships = await scholarshipsCollection.find({}).toArray();
    const eligibleScholarships = scholarships.filter(scholarship => {
        if (user.is_student !== "Yes") return false;
        const matches = (value, allowedValues) => {
            if (!allowedValues) return true;
            const userValue = String(value).toLowerCase();
            const allowed = Array.isArray(allowedValues)
                ? allowedValues.map(v => String(v).toLowerCase())
                : [String(allowedValues).toLowerCase()];
            return allowed.includes(userValue);
        };
        if (!matches(user.course_type, scholarship.course_type)) return false;
        if (!matches(user.academic_year, scholarship.academic_year)) return false;
        if (!matches(user.category, scholarship.category)) return false;
        if (!matches(user.domicile_state, scholarship.domicile)) return false;
        if (scholarship.income_limit && user.annual_income > scholarship.income_limit) return false;
        if (!matches(user.gender, scholarship.gender)) return false;
        if (!matches(user.institute_type, scholarship.institute_type)) return false;
        if (!matches(user.admission_type, scholarship.admission_type)) return false;
        if (scholarship.qualification_exam_score && user.qualification_exam_score < scholarship.qualification_exam_score) return false;
        if (scholarship.age_limit) {
            const userAge = calculateAge(user.date_of_birth);
            if (userAge < scholarship.age_limit.min || userAge > scholarship.age_limit.max) return false;
        }
        return true;
    });
    return eligibleScholarships;
}

// Helper function to calculate age
function calculateAge(dateOfBirth) {
    const dob = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
        age--;
    }
    return age;
}

// Profile Page Route
router.get('/profile', async (req, res) => {
    try {
        const db = getDB();
        const usersCollection = db.collection('user_details');
        const applicationsCollection = db.collection('applications');
        const notificationsCollection = db.collection('notifications');
        const userEmail = req.session.userEmail;

        if (!userEmail) {
            return res.status(401).send("Unauthorized. Please log in.");
        }
        
        console.log("Fetching user details for email:", userEmail);
        const user = await usersCollection.findOne({ email: userEmail });
        console.log("User fetched:", user);

        if (!user) {
            return res.status(404).send("User not found.");
        }

        const userId = user._id;
        console.log("User ID:", userId);

        // Fetch notifications
        console.log("Fetching notifications for user ID:", userId);
        const notifications = await notificationsCollection.find({ user_id: userId })
            .sort({ timestamp: -1 })
            .toArray();
        console.log("Fetched Notifications:", notifications);

        // Check completed fields
        const requiredFields = ['first_name', 'last_name', 'gender', 'date_of_birth', 'category', 'domicile_state', 'religion', 'address', 'phone_number', 'is_student'];
        const completedFields = requiredFields.filter(field => user[field] !== undefined && user[field] !== null && user[field] !== '');
        
        if (completedFields.length < 3) {
            console.log("User has less than 3 completed fields, redirecting to home.");
            return res.redirect('/');
        }

        // Fetch eligible scholarships
        console.log("Fetching eligible scholarships for user:", user);
        const scholarships = await getEligibleScholarships(user);
        console.log("Eligible scholarships:", scholarships);
        
        const scholarshipsWithStrings = scholarships.map(scholarship => ({
            ...scholarship,
            category: scholarship.category ? scholarship.category.join(', ') : 'Not specified',
            course_type: scholarship.course_type ? scholarship.course_type.join(', ') : 'Not specified'
        }));

        // Fetch applications
        console.log("Fetching applications for user email:", userEmail);
        const applications = await applicationsCollection.aggregate([
            { $match: { userId: userEmail } },
            { $lookup: { from: 'scholarships', localField: 'scholarshipID', foreignField: 'scholarshipID', as: 'scholarship' } },
            { $unwind: '$scholarship' },
            { $project: { scholarshipID: 1, scholarshipName: '$scholarship.name', status: 1, applicationNo: 1, createdAt: 1 } }
        ]).toArray();
        console.log("Fetched Applications:", applications);
        
        res.render('profile', {
            user,
            scholarships: scholarshipsWithStrings,
            applications,
            notifications,
            helpers: {
                formatDate: function(date) {
                    return new Date(date).toLocaleString('en-IN');
                }
            }
        });
    } catch (error) {
        console.error("Error fetching user details or notifications:", error);
        res.status(500).send("An error occurred while fetching user details and notifications.");
    }
});


// Profile View/Edit Page Route
router.get('/profile-view', async (req, res) => {
    try {
        const db = getDB();
        const usersCollection = db.collection('user_details');
        const userEmail = req.session.userEmail;
        if (!userEmail) {
            return res.status(401).send("Unauthorized. Please log in.");
        }
        const user = await usersCollection.findOne({ email: userEmail });
        if (!user) {
            return res.status(404).send("User not found.");
        }
        user.isStudentYes = user.is_student === "Yes";
        user.previousScholarshipYes = user.previous_scholarship === "1";
        user.singleGirlChildYes = user.single_girl_child === "1";
        user.course_type = user.course_type || user.course_name;
        res.render('profile-view', { user });
    } catch (error) {
        console.error("Error fetching user details:", error);
        res.status(500).send("An error occurred while fetching user details.");
    }
});

// Handle Profile Edit Submission
router.post('/profile-view', async (req, res) => {
    try {
        const db = getDB();
        const usersCollection = db.collection('user_details');
        const userEmail = req.session.userEmail;
        if (!userEmail) {
            return res.status(401).send("Unauthorized. Please log in.");
        }
        const updatedData = {
            first_name: req.body.first_name,
            last_name: req.body.last_name,
            gender: req.body.gender,
            date_of_birth: req.body.date_of_birth,
            category: req.body.category,
            caste: req.body.caste,
            domicile_state: req.body.domicile_state,
            religion: req.body.religion,
            address: req.body.address,
            phone_number: req.body.phone_number,
            is_student: req.body.is_student,
            annual_income: req.body.annual_income ? parseFloat(req.body.annual_income) : null,
            course_type: req.body.course_type,
            aadhar: req.body.aadhar
        };
        await usersCollection.updateOne(
            { email: userEmail },
            { $set: updatedData }
        );
        res.redirect('/profile');
    } catch (error) {
        console.error("Error updating profile:", error);
        res.status(500).send("An error occurred while updating profile.");
    }
});

// My Scholarships (Generate Freeship) Route
router.get('/generate-freeship', async (req, res) => {
    try {
        const db = getDB();
        const usersCollection = db.collection('user_details');
        const userEmail = req.session.userEmail;
        if (!userEmail) {
            return res.status(401).send("Unauthorized. Please log in.");
        }
        const user = await usersCollection.findOne({ email: userEmail });
        if (!user) {
            return res.status(404).send("User not found.");
        }
        const scholarships = await getEligibleScholarships(user);
        const scholarshipsWithStrings = scholarships.map(scholarship => ({
            ...scholarship,
            category: scholarship.category ? scholarship.category.join(', ') : 'Not specified',
            course_type: scholarship.course_type ? scholarship.course_type.join(', ') : 'Not specified'
        }));
        res.render('generate_freeship', { user, scholarships: scholarshipsWithStrings });
    } catch (error) {
        console.error("Error fetching eligible scholarships:", error);
        res.status(500).send("An error occurred while fetching eligible scholarships.");
    }
});

// Approved Applications Route
router.get('/approved-applications', async (req, res) => {
    try {
        const db = getDB();
        const applicationsCollection = db.collection('applications');
        const userEmail = req.session.userEmail;
        if (!userEmail) {
            return res.status(401).send("Unauthorized. Please log in.");
        }
        const approvedApplications = await applicationsCollection.aggregate([
            { $match: { userId: userEmail, status: 'certified' } },
            { $lookup: { from: 'scholarships', localField: 'scholarshipID', foreignField: 'scholarshipID', as: 'scholarship' } },
            { $unwind: '$scholarship' },
            { $project: { scholarshipID: 1, scholarshipName: '$scholarship.name', applicationNo: 1, pdfPath: 1, createdAt: 1 } }
        ]).toArray();
        res.render('approved_applications', { applications: approvedApplications });
    } catch (error) {
        console.error("Error fetching approved applications:", error);
        res.status(500).send("An error occurred while fetching approved applications.");
    }
});
    /*router.get('/notice-board', async (req, res) => {
        try {
            const db = getDB();
            const userEmail = req.session.userEmail;
            if (!userEmail) return res.status(401).send("Unauthorized");
            console.log(userEmail);
            // Get user's _id from email
            const user = await db.collection('user_details').findOne({ email: userEmail });
            console.log("User ID from session:", user.user_id);
            console.log("User ID from notifications:", await db.collection('notifications').distinct("user_id"));

            if (!user) return res.status(404).send("User not found");
            const userId=user._id

    
            // Fetch notifications
            const notifications = await db.collection('notifications')
                .find({ user_id: userId })
                .sort({ timestamp: -1 })
                .toArray();
    
            // Debugging Log
            console.log("Fetched Notifications:", notifications);
            console.log("Sending to frontend:", { user, notifications });
            res.render('notice_board', {
                notifications,
                helpers: {
                    formatDate: function(date) {
                        return new Date(date).toLocaleString('en-IN');
                    }
                }
            });

            // Pass notifications to the frontend (ensure you have the correct template file)
        } catch (error) {
            console.error("Error fetching notifications:", error);
            res.status(500).send("Server Error");
        }
    });*/
    


// All Scholarships Route
router.get('/all-scholarships', async (req, res) => {
    try {
        const db = getDB();
        const scholarshipsCollection = db.collection('scholarships');
        const scholarships = await scholarshipsCollection.find({}).toArray();
        const scholarshipsWithStatus = scholarships.map(scholarship => ({
            ...scholarship,
            status: getScholarshipStatus(scholarship.deadline)
        }));
        res.json(scholarshipsWithStatus);
    } catch (error) {
        console.error("Error fetching scholarships:", error);
        res.status(500).json({ message: "An error occurred while fetching scholarships." });
    }
});

// Search Scholarships Route
router.get('/search-scholarships', async (req, res) => {
    try {
        const { category, gender, income_limit, domicile, qualification_exam_score, course_type, search } = req.query;
        const db = getDB();
        const scholarshipsCollection = db.collection('scholarships');
        let query = {};
        if (search) query.name = { $regex: search, $options: 'i' };
        if (income_limit && !isNaN(income_limit)) query.income_limit = { $gte: parseInt(income_limit) };
        if (qualification_exam_score && !isNaN(qualification_exam_score)) query.qualification_exam_score = { $lte: parseInt(qualification_exam_score) };
        if (domicile) query.domicile = { $regex: new RegExp(`^${domicile}$`, 'i') };
        if (course_type) query.course_type = { $regex: new RegExp(`^${course_type}$`, 'i') };
        if (category) query.category = { $in: [new RegExp(`^${category}$`, 'i')] };
        if (gender) query.gender = { $in: [new RegExp(`^${gender}$`, 'i')] };
        let results = await scholarshipsCollection.find(query).toArray();
        const scholarshipsWithStrings = results.map(scholarship => ({
            ...scholarship,
            category: Array.isArray(scholarship.category) ? scholarship.category.join(', ') : 'Not specified',
            course_type: Array.isArray(scholarship.course_type) ? scholarship.course_type.join(', ') : 'Not specified',
            status: getScholarshipStatus(scholarship.deadline)
        }));
        res.json(scholarshipsWithStrings);
    } catch (error) {
        console.error('Error searching scholarships:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Scholarship Details Routes
router.get('/scholarship/:id', async (req, res) => {
    try {
        const db = getDB();
        const scholarshipDescriptionCollection = db.collection('scholarship_description');
        const { id } = req.params;
        const scholarship = await scholarshipDescriptionCollection.findOne({ scholarshipID: parseInt(id) });
        if (!scholarship) {
            return res.status(404).send("Scholarship not found.");
        }
        res.json(scholarship);
    } catch (error) {
        console.error('Error fetching scholarship details:', error);
        res.status(500).send("An error occurred while fetching scholarship details.");
    }
});

router.get('/scholarship/details/:id', async (req, res) => {
    try {
        const db = getDB();
        const scholarshipDescriptionCollection = db.collection('scholarship_description');
        const applicationsCollection = db.collection('applications');
        const { id } = req.params;
        const userEmail = req.session.userEmail;
        const scholarship = await scholarshipDescriptionCollection.findOne({ scholarshipID: parseInt(id) });
        if (!scholarship) {
            return res.status(404).send("Scholarship not found.");
        }
        let hasApplied = false;
        let canReapply = false;
        if (userEmail) {
            const existingApplication = await applicationsCollection.findOne({
                scholarshipID: parseInt(id),
                userId: userEmail
            });
            if (existingApplication) {
                hasApplied = existingApplication.status !== 'rejected'; // Only count as applied if not rejected
                canReapply = existingApplication.status === 'rejected'; // Allow reapply if rejected
            }
        }
        res.render('scholarship_details', { scholarship, hasApplied, canReapply });
    } catch (error) {
        console.error('Error fetching scholarship details:', error);
        res.status(500).send("An error occurred while fetching scholarship details.");
    }
});

// Add Scheme Routes
router.get('/add-scheme', (req, res) => {
    if (!req.session.adminUsername) {
        return res.status(401).send("Unauthorized. Please log in as an admin.");
    }
    const scholarshipID = Math.floor(100000 + Math.random() * 900000);
    res.render('add_scheme_form1', { scholarshipID });
});

router.post('/add-scheme-form1', async (req, res) => {
    if (!req.session.adminUsername) {
        return res.status(401).send("Unauthorized. Please log in as an admin.");
    }
    const formData = req.body;
    formData.course_type = formData.course_type.split(',').map(item => item.trim());
    formData.category = formData.category.split(',').map(item => item.trim());
    formData.domicile = formData.domicile.split(',').map(item => item.trim());
    if (formData.gender) formData.gender = formData.gender.split(',').map(item => item.trim());
    if (formData.admission_type === "not_required") formData.admission_type = null;
    formData.income_limit = Number(formData.income_limit);
    req.session.scholarshipData = formData;
    console.log(formData);
    res.redirect('/add-scheme-form2');
});

router.get('/add-scheme-form2', (req, res) => {
    if (!req.session.adminUsername || !req.session.scholarshipData) {
        return res.status(401).send("Unauthorized. Please log in as an admin.");
    }
    res.render('add_scheme_form2');
});

router.post('/add-scheme-form2', async (req, res) => {
    if (!req.session.adminUsername || !req.session.scholarshipData) {
        return res.status(401).send("Unauthorized. Please log in as an admin.");
    }
    const { confirmation, ...descriptionData } = req.body;
    if (confirmation !== "CONFIRM") {
        return res.status(400).send("Please type 'CONFIRM' to add the scholarship.");
    }
    try {
        const db = getDB();
        const scholarshipsCollection = db.collection('scholarships');
        const descriptionCollection = db.collection('scholarship_description');
        const scholarshipData = req.session.scholarshipData;
        scholarshipData.scholarshipID = parseInt(scholarshipData.scholarshipID); // Ensure integer
        await scholarshipsCollection.insertOne(scholarshipData);
        descriptionData.scholarshipID = scholarshipData.scholarshipID;
        await descriptionCollection.insertOne(descriptionData);
        console.log("Notifying eligible users for scholarship:", scholarshipData);
        await notifyEligibleUsers(scholarshipData);
        req.session.scholarshipData = null;
        res.redirect('/admin-panel');
    } catch (error) {
        console.error("Error adding scholarship:", error);
        res.status(500).send("An error occurred while adding the scholarship.");
    }
});

// Remove Scheme Routes
router.get('/remove-scheme', async (req, res) => {
    if (!req.session.adminUsername) {
        return res.status(401).send("Unauthorized. Please log in as an admin.");
    }
    try {
        const db = getDB();
        const scholarshipsCollection = db.collection('scholarships'); // Your collection name
        const applicationsCollection = db.collection('applications'); // Collection for applications

        // Fetch scholarships
        const scholarships = await scholarshipsCollection.find({}).toArray();

        // Fetch count of pending applications
        const pendingFormsCount = await applicationsCollection.countDocuments({ status: 'pending' });

        // Render the template with both variables
        res.render('remove_scheme', { scholarships, pendingFormsCount }); // Note: 'remove_schemes' matches your file name
    } catch (error) {
        console.error("Error fetching scholarships or pending forms count:", error);
        res.status(500).send("An error occurred while fetching data.");
    }
});

router.get('/search-scholarships-admin', async (req, res) => {
    try {
        const { search } = req.query;
        const db = getDB();
        const scholarshipsCollection = db.collection('scholarships');
        let query = {};
        if (search) query.name = { $regex: search, $options: 'i' };
        const scholarships = await scholarshipsCollection.find(query).toArray();
        res.json(scholarships);
    } catch (error) {
        console.error("Error searching scholarships:", error);
        res.status(500).json({ message: "An error occurred while searching scholarships." });
    }
});

router.post('/delete-scholarship', async (req, res) => {
    if (!req.session.adminUsername) {
        return res.status(401).send("Unauthorized. Please log in as an admin.");
    }
    const { scholarshipID, confirmation } = req.body;
    if (confirmation !== "CONFIRM") {
        return res.status(400).send("Please type 'CONFIRM' to delete the scholarship.");
    }
    try {
        const db = getDB();
        const scholarshipsCollection = db.collection('scholarships');
        const descriptionCollection = db.collection('scholarship_description');
        const scholarshipIDNumber = parseInt(scholarshipID);
        const deleteScholarshipResult = await scholarshipsCollection.deleteOne({ scholarshipID: scholarshipIDNumber });
        const deleteDescriptionResult = await descriptionCollection.deleteOne({ scholarshipID: scholarshipIDNumber });
        if (deleteScholarshipResult.deletedCount === 0 || deleteDescriptionResult.deletedCount === 0) {
            return res.status(404).send("Scholarship not found or could not be deleted.");
        }
        res.redirect('/remove-scheme');
    } catch (error) {
        console.error("Error deleting scholarship:", error);
        res.status(500).send("An error occurred while deleting the scholarship.");
    }
});

// Modify Scheme Routes
router.get('/modify-scheme/:id', async (req, res) => {
    if (!req.session.adminUsername) {
        return res.status(401).send("Unauthorized. Please log in as an admin.");
    }
    try {
        const db = getDB();
        const scholarshipID = parseInt(req.params.id);
        const scholarship = await db.collection('scholarships').findOne({ scholarshipID });
        const scholarshipDescription = await db.collection('scholarship_description').findOne({ scholarshipID });
        if (!scholarship || !scholarshipDescription) {
            return res.status(404).send("Scholarship not found.");
        }
        res.render('modify_scheme', { scholarship, scholarshipDescription });
    } catch (error) {
        console.error("Error fetching scholarship details:", error);
        res.status(500).send("An error occurred while fetching scholarship details.");
    }
});

router.post('/save-scheme/:id', async (req, res) => {
    if (!req.session.adminUsername) {
        return res.status(401).send("Unauthorized. Please log in as an admin.");
    }
    try {
        const db = getDB();
        const scholarshipID = parseInt(req.params.id);
        const updatedScholarship = req.body.scholarship;
        const updatedDescription = req.body.description;
        await db.collection('scholarships').updateOne(
            { scholarshipID },
            { $set: updatedScholarship }
        );
        await db.collection('scholarship_description').updateOne(
            { scholarshipID },
            { $set: updatedDescription }
        );
        res.redirect('/remove-scheme');
    } catch (error) {
        console.error("Error updating scholarship:", error);
        res.status(500).send("An error occurred while updating the scholarship.");
    }
});

// Apply Scholarship Route
router.get('/apply-scholarship/:id', async (req, res) => {
    const scholarshipID = req.params.id;
    try {
        const db = getDB();
        const scholarship = await db.collection('scholarships').findOne({ scholarshipID: parseInt(scholarshipID) });
        if (!scholarship) {
            return res.status(404).send("Scholarship not found.");
        }
        const userEmail = req.session.userEmail;
        if (!userEmail) {
            return res.status(401).send("Unauthorized. Please log in.");
        }
        const user = await db.collection('user_details').findOne({ email: userEmail });
        if (!user) {
            return res.status(404).send("User not found.");
        }
        res.render('apply_scholarship', { scholarship, user });
    } catch (error) {
        console.error("Error fetching scholarship or user details:", error);
        res.status(500).send("An error occurred while fetching details.");
    }
});

// Submit Application Route
router.post('/submit-application', upload.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'incomeCertificate', maxCount: 1 },
    { name: 'aadharCard', maxCount: 1 },
    { name: 'markSheet', maxCount: 1 },
    { name: 'categoryCertificate', maxCount: 1 },
    { name: 'bankPassbook', maxCount: 1 },
    { name: 'institutionCertificate', maxCount: 1 }
]), async (req, res) => {
    const formData = req.body;
    const files = req.files;
    try {
        const db = getDB();
        const scholarshipID = parseInt(req.body.scholarshipID, 10);
        
        // Validate scholarship ID
        if (isNaN(scholarshipID)) {
            throw new Error('Invalid scholarshipID');
        }

        // Check if user already has a certified application
        const existingApplication = await db.collection('applications').findOne({
            scholarshipID: scholarshipID,
            userId: req.session.userEmail,
            status: 'certified'
        });
        
        if (existingApplication) {
            return res.status(400).send("You have already successfully applied for this scholarship.");
        }

        // Create uploads directory if it doesn't exist
        const uploadDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        // Generate PDF with relative path
        const { pdfPath, applicationNo } = await generatePDF(formData, files);
        
        // Store only the relative path in database
        const relativePdfPath = path.relative(path.join(__dirname, '../'), pdfPath);

        // Insert application with relative path
        await db.collection('applications').insertOne({
            scholarshipID: scholarshipID,
            userId: req.session.userEmail,
            pdfPath: relativePdfPath,  // Store relative path
            applicationNo: applicationNo,
            status: 'pending',
            createdAt: new Date(),
            scholarshipName: formData.scholarshipName || 'Unknown Scholarship' // Add scholarship name
        });

        // Send confirmation email
        const subject = 'Application Submitted - Smart Scheme';
        const text = `Dear ${req.session.userEmail},\n\nYour application has been successfully submitted.\n\nApplication Number: ${applicationNo}\n\nThank you for using Smart Scheme.`;
        await sendEmail(req.session.userEmail, subject, text);

        res.redirect('/profile');
    } catch (error) {
        console.error("Error submitting application:", error);
        
        // Clean up uploaded files if error occurred
        if (req.files) {
            Object.values(req.files).forEach(fileArray => {
                fileArray.forEach(file => {
                    try {
                        fs.unlinkSync(file.path);
                    } catch (err) {
                        console.error("Error deleting temporary file:", err);
                    }
                });
            });
        }

        res.status(500).render('error', { 
            message: 'Application submission failed',
            error: req.app.get('env') === 'development' ? error : {}
        });
    }
});

// Updated generatePDF function (partial example)
async function generatePDF(formData, files) {
    const pdfDoc = await PDFDocument.create();
    // ... your existing PDF generation code ...

    // Use consistent path handling
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    const pdfFileName = `application_${Date.now()}.pdf`;
    const pdfPath = path.join(uploadDir, pdfFileName);
    const pdfBytes = await pdfDoc.save();
    
    fs.writeFileSync(pdfPath, pdfBytes);
    
    return {
        pdfPath: path.join('uploads', pdfFileName), // Return relative path
        applicationNo: `APP-${Math.floor(Math.random() * 1000000)}`
    };
}

// PDF Generation Function
async function generatePDF(formData, files) {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const page = pdfDoc.addPage([612, 792]);
    const black = rgb(0, 0, 0);
    const applicationNo = `APP-${Math.floor(Math.random() * 1000000)}`;
    page.drawText('Prof Joseph Mudassery Scholarship Application Form', {
        x: 120,
        y: 750,
        size: 16,
        font: boldFont,
        color: black
    });
    page.drawText(`Application No: ${applicationNo}`, { x: 50, y: 720, size: 10, font: font, color: black });
    page.drawText(`Date: ${new Date().toLocaleDateString('en-IN')}`, { x: 400, y: 720, size: 10, font: font, color: black });
    if (files.photo && files.photo[0]) {
        try {
            const photoPath = files.photo[0].path;
            if (!fs.existsSync(photoPath)) throw new Error('Photo file not found');
            const imageBytes = fs.readFileSync(photoPath);
            let image;
            if (files.photo[0].mimetype === 'image/jpeg' || files.photo[0].mimetype === 'image/jpg') {
                image = await pdfDoc.embedJpg(imageBytes);
            } else if (files.photo[0].mimetype === 'image/png') {
                image = await pdfDoc.embedPng(imageBytes);
            } else {
                throw new Error('Unsupported image format');
            }
            const aspectRatio = image.width / image.height;
            let width = 120;
            let height = 120;
            if (aspectRatio > 1) height = width / aspectRatio;
            else width = height * aspectRatio;
            page.drawImage(image, { x: 450, y: 720 - 130, width: width, height: height });
            page.drawRectangle({ x: 450, y: 720 - 130, width: 120, height: 120, borderColor: black, borderWidth: 1 });
        } catch (error) {
            console.error("Error embedding photo:", error.message);
            page.drawRectangle({ x: 450, y: 720 - 130, width: 120, height: 120, borderColor: black, borderWidth: 1 });
            page.drawText('Photo Not Available', { x: 460, y: 720 - 90, size: 8, font: font, color: black });
        }
    }
    const boxWidth = 512;
    const boxPadding = 15;
    const sectionHeaderHeight = 18;
    const fieldHeight = 20;
    const sectionGap = 15;
    let currentY = 680;
    const personalFields = 11;
    const personalBoxHeight = (personalFields * fieldHeight) + (boxPadding * 2);
    page.drawRectangle({ x: 50, y: currentY - personalBoxHeight, width: boxWidth - 150, height: personalBoxHeight, borderColor: black, borderWidth: 1 });
    page.drawText('PERSONAL INFORMATION', { x: 60, y: currentY - sectionHeaderHeight, size: 12, font: boldFont, color: black });
    const personalDetails = [
        { label: 'Name', value: `${formData.firstName} ${formData.lastName}` },
        { label: 'Gender', value: formData.gender || 'N/A' },
        { label: 'Category', value: formData.category || 'N/A' },
        { label: 'Caste', value: formData.caste || 'N/A' },
        { label: 'Date of Birth', value: formData.dob || 'N/A' },
        { label: 'Father\'s Name', value: formData.fatherName || 'N/A' },
        { label: 'Mother\'s Name', value: formData.motherName || 'N/A' },
        { label: 'Father\'s Occupation', value: formData.fatherOccupation || 'N/A' },
        { label: 'Mother\'s Occupation', value: formData.motherOccupation || 'N/A' },
        { label: 'Annual Income (INR)', value: formData.annualIncome || 'N/A' },
        { label: 'Aadhar Number', value: formData.aadharNumber || 'N/A' }
    ];
    let fieldY = currentY - boxPadding - sectionHeaderHeight - 5;
    personalDetails.forEach(item => {
        page.drawText(`${item.label}:`, { x: 60, y: fieldY, size: 10, font: boldFont, color: black });
        page.drawText(item.value, { x: 180, y: fieldY, size: 10, font: font, color: black, maxWidth: 200 });
        fieldY -= fieldHeight;
    });
    currentY = currentY - personalBoxHeight - sectionGap;
    const academicFields = 5;
    const academicBoxHeight = (academicFields * fieldHeight) + (boxPadding * 2);
    page.drawRectangle({ x: 50, y: currentY - academicBoxHeight, width: boxWidth, height: academicBoxHeight, borderColor: black, borderWidth: 1 });
    page.drawText('ACADEMIC INFORMATION', { x: 60, y: currentY - sectionHeaderHeight, size: 12, font: boldFont, color: black });
    const academicDetails = [
        { label: 'Course Type', value: formData.courseType || 'N/A' },
        { label: 'Academic Year', value: formData.academicYear || 'N/A' },
        { label: 'Institution Name', value: formData.institutionName || 'N/A' },
        { label: 'Admission Type', value: formData.admissionType || 'N/A' },
        { label: 'Qualification Exam Score', value: formData.qualificationExamScore || 'N/A' }
    ];
    fieldY = currentY - boxPadding - sectionHeaderHeight - 5;
    academicDetails.forEach(item => {
        page.drawText(`${item.label}:`, { x: 60, y: fieldY, size: 10, font: boldFont, color: black });
        page.drawText(item.value, { x: 220, y: fieldY, size: 10, font: font, color: black, maxWidth: 280 });
        fieldY -= fieldHeight;
    });
    currentY = currentY - academicBoxHeight - sectionGap;
    const bankFields = 3;
    const bankBoxHeight = (bankFields * fieldHeight) + (boxPadding * 2);
    page.drawRectangle({ x: 50, y: currentY - bankBoxHeight, width: boxWidth, height: bankBoxHeight, borderColor: black, borderWidth: 1 });
    page.drawText('BANK ACCOUNT INFORMATION', { x: 60, y: currentY - sectionHeaderHeight, size: 12, font: boldFont, color: black });
    const bankDetails = [
        { label: 'Bank Name', value: formData.bankName || 'N/A' },
        { label: 'Account Number', value: formData.accountNumber || 'N/A' },
        { label: 'IFSC Code', value: formData.ifscCode || 'N/A' }
    ];
    fieldY = currentY - boxPadding - sectionHeaderHeight - 5;
    bankDetails.forEach(item => {
        page.drawText(`${item.label}:`, { x: 60, y: fieldY, size: 10, font: boldFont, color: black });
        page.drawText(item.value, { x: 220, y: fieldY, size: 10, font: font, color: black, maxWidth: 280 });
        fieldY -= fieldHeight;
    });
    currentY = currentY - bankBoxHeight - sectionGap;
    page.drawText('Signature of Applicant:', { x: 400, y: currentY - 10, size: 10, font: font, color: black });
    page.drawLine({ start: { x: 400, y: currentY - 25 }, end: { x: 560, y: currentY - 25 }, thickness: 1, color: black });
    const docs = [
        { name: 'Income Certificate', file: files.incomeCertificate },
        { name: 'Aadhar Card', file: files.aadharCard },
        { name: 'Mark Sheet', file: files.markSheet },
        { name: 'Category Certificate', file: files.categoryCertificate },
        { name: 'Bank Passbook', file: files.bankPassbook },
        { name: 'Institution Certificate', file: files.institutionCertificate }
    ];
    for (const doc of docs) {
        if (doc.file && doc.file[0]) {
            try {
                const docBytes = fs.readFileSync(doc.file[0].path);
                if (doc.file[0].mimetype === 'application/pdf') {
                    const donorPdf = await PDFDocument.load(docBytes);
                    const pages = await pdfDoc.copyPages(donorPdf, donorPdf.getPageIndices());
                    pages.forEach(p => pdfDoc.addPage(p));
                } else {
                    const image = await pdfDoc.embedJpg(docBytes);
                    const newPage = pdfDoc.addPage([612, 792]);
                    newPage.drawText(doc.name, { x: 50, y: 750, size: 12, font: boldFont, color: black });
                    newPage.drawImage(image, { x: 50, y: 400, width: 512, height: 300 });
                }
            } catch (error) {
                console.error(`Error processing ${doc.name}:`, error);
            }
        }
    }
    const pdfBytes = await pdfDoc.save();
    const pdfPath = path.join(__dirname, `../uploads/application_${Date.now()}.pdf`);
    fs.writeFileSync(pdfPath, pdfBytes);
    return { pdfPath, applicationNo };
}

// Enhanced Verify Forms Route
router.get('/verify-forms', async (req, res) => {
    try {
        if (!req.session.adminUsername && !req.session.testerId) {
            return res.status(403).send('Access denied.');
        }
        const db = getDB();
        
        // Get applications assigned to the current user or unassigned
        const applications = await db.collection('applications').aggregate([
            { $match: { status: 'pending' } },
            { $lookup: {
                from: 'scholarships',
                localField: 'scholarshipID',
                foreignField: 'scholarshipID',
                as: 'scholarship'
            }},
            { $unwind: '$scholarship' },
            { $match: {
                $or: [
                    { assignedTo: { $exists: false } },
                    { assignedTo: req.session.adminUsername || req.session.testerId }
                ]
            }},
            { $project: {
                _id: 1,
                userId: 1,
                scholarshipID: 1,
                applicationNo: 1,
                pdfPath: 1,
                createdAt: 1,
                status: 1,
                scholarshipName: '$scholarship.name',
                assignedTo: 1
            }}
        ]).toArray();

        // Get count of pending forms
        const pendingFormsCount = await db.collection('applications').countDocuments({ status: 'pending' });

        res.render('verify_forms', { 
            applications, 
            pendingFormsCount,
            helpers: {
                formatDate: function(date) {
                    return new Date(date).toLocaleDateString('en-IN');
                }
            }
        });
    } catch (error) {
        console.error('Error fetching pending applications:', error.message);
        res.status(500).send('An error occurred while fetching pending applications.');
    }
});

router.get('/view-pdf', (req, res) => {
    const pdfPath = req.query.path;
    const normalizedPath = path.normalize(pdfPath.replace(/D:\\Mini_Project_SmartScheme\\Smartscheme4\\/g, ''));
    const absolutePath = path.join(__dirname, '..', normalizedPath);
    
    if (fs.existsSync(absolutePath)) {
        res.sendFile(absolutePath);
    } else {
        console.error('PDF not found at:', absolutePath);
        res.status(404).send('PDF file not found');
    }
});

router.post('/mark-certified/:id', async (req, res) => {
    if (!req.session.adminUsername && !req.session.testerId) {
        return res.status(401).send("Unauthorized");
    }
    
    try {
        const db = getDB();
        const applicationId = new ObjectId(req.params.id);
        const application = await db.collection('applications').findOne({ _id: applicationId });
        
        if (!application) {
            return res.status(404).send("Application not found");
        }

        if (application.assignedTo && application.assignedTo !== (req.session.adminUsername || req.session.testerId)) {
            return res.status(403).send("This application is assigned to another user");
        }

        const absolutePath = path.resolve(application.pdfPath);
        
        if (!fs.existsSync(absolutePath)) {
            throw new Error(`PDF file not found at path: ${absolutePath}`);
        }

        await addCertifiedWatermark(absolutePath);
        
        await db.collection('applications').updateOne(
            { _id: applicationId },
            { $set: { 
                status: 'certified', 
                certifiedAt: new Date(),
                certifiedBy: req.session.adminUsername || req.session.testerId,
                rejectionReason: null 
            } }
        );
        
        const user = await db.collection('user_details').findOne({ email: application.userId });
        if (user) {
            const subject = 'Application Certified - Smart Scheme';
            const text = `Dear ${user.first_name},\n\nYour application for ${application.scholarshipName} has been certified.\n\nApplication ID: ${application.applicationNo}\n\nYou can now download the certified copy from your profile.`;
            await sendEmail(application.userId, subject, text);
        }
        
        res.sendStatus(200);
    } catch (error) {
        console.error("Error marking application as certified:", error);
        res.status(500).send("Error certifying application: " + error.message);
    }
});

router.post('/mark-rejected/:id', async (req, res) => {
    if (!req.session.adminUsername && !req.session.testerId) {
        return res.status(401).send("Unauthorized");
    }
    
    try {
        const db = getDB();
        const applicationId = new ObjectId(req.params.id);
        const { reason } = req.body;
        
        if (!reason || reason.trim() === '') {
            return res.status(400).send("Rejection reason is required");
        }

        const application = await db.collection('applications').findOne({ _id: applicationId });
        if (!application) {
            return res.status(404).send("Application not found");
        }

        if (application.assignedTo && application.assignedTo !== (req.session.adminUsername || req.session.testerId)) {
            return res.status(403).send("This application is assigned to another user");
        }
        
        await db.collection('applications').updateOne(
            { _id: applicationId },
            { $set: { 
                status: 'rejected', 
                rejectionReason: reason.trim(),
                rejectedAt: new Date(),
                rejectedBy: req.session.adminUsername || req.session.testerId
            } }
        );
        
        const user = await db.collection('user_details').findOne({ email: application.userId });
        if (user) {
            const subject = 'Application Rejected - Smart Scheme';
            const text = `Dear ${user.first_name},\n\nWe regret to inform you that your application for ${application.scholarshipName} has been rejected.\n\nReason: ${reason}\n\nApplication ID: ${application.applicationNo}\n\nPlease contact support if you have any questions.`;
            await sendEmail(application.userId, subject, text);
        }
        
        res.sendStatus(200);
    } catch (error) {
        console.error("Error rejecting application:", error);
        res.status(500).send("Error rejecting application");
    }
});

function degrees(angle) {
    return pdfLibDegrees(angle); // Use pdf-lib's degrees function
}

async function addCertifiedWatermark(pdfPath) {
    try {
        const pdfBytes = fs.readFileSync(pdfPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const pages = pdfDoc.getPages();
        
        // Use Helvetica-Bold or fallback
        let font;
        try {
            font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        } catch {
            font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        }

        // Add watermark to each page
        pages.forEach(page => {
            const { width, height } = page.getSize();
            
            // Diagonal watermark with corrected rotate option
            page.drawText('CERTIFIED - SMARTSCHEME', {
                x: width / 2 - 150,
                y: height / 2,
                size: 32,
                color: rgb(0.8, 0.8, 0.8),
                opacity: 0.3,
                rotate: degrees(-30), // Now uses pdf-lib's degrees function
                font
            });

            // Certification stamp on first page
            if (page === pages[0]) {
                page.drawText('OFFICIALLY CERTIFIED', {
                    x: width - 180,
                    y: 30,
                    size: 12,
                    color: rgb(0, 0.5, 0),
                    font
                });
            }
        });

        const modifiedPdfBytes = await pdfDoc.save();
        fs.writeFileSync(pdfPath, modifiedPdfBytes);
    } catch (error) {
        console.error("Watermarking failed:", error);
        throw error;
    }
}

// Download PDF Route
router.get('/download-pdf/:id', async (req, res) => {
    try {
        const db = getDB();
        const applicationId = new ObjectId(req.params.id);
        const application = await db.collection('applications').findOne({ _id: applicationId });
        if (!application) {
            return res.status(404).send("Application not found.");
        }
        if (application.status !== 'certified') {
            return res.status(400).send("Application is not certified.");
        }
        const pdfPath = application.pdfPath;
        res.download(pdfPath, 'certified_application.pdf');
    } catch (error) {
        console.error("Error downloading PDF:", error);
        res.status(500).send("An error occurred while downloading the PDF.");
    }
});

router.get('/official-login', (req, res) => {
    res.render('official_login');
});

router.post('/official-login', async (req, res) => {
    const { testerId, password } = req.body;
    try {
        const db = getDB();
        const testerCollection = db.collection('testers');
        const tester = await testerCollection.findOne({ testerId });
        if (!tester) {
            return res.status(400).send("Tester not found.");
        }
        if (tester.password !== password) {
            return res.status(400).send("Invalid password.");
        }
        req.session.testerId = tester.testerId;
        res.redirect('/official-panel');
    } catch (error) {
        console.error("Error during tester login:", error);
        res.status(500).send("An error occurred during tester login.");
    }
});

router.get('/official-panel', async (req, res) => {
    if (!req.session.testerId) {
        return res.status(401).send("Unauthorized. Please log in as a tester.");
    }
    try {
        const db = getDB();
        const applications = await db.collection('applications').aggregate([
            { $match: { 
                status: 'pending',
                $or: [
                    { assignedTo: { $exists: false } },
                    { assignedTo: req.session.testerId }
                ]
            }},
            { $lookup: {
                from: 'scholarships',
                localField: 'scholarshipID',
                foreignField: 'scholarshipID',
                as: 'scholarship'
            }},
            { $unwind: '$scholarship' },
            { $project: {
                _id: 1,
                userId: 1,
                scholarshipID: 1,
                applicationNo: 1,
                pdfPath: 1,
                createdAt: 1,
                status: 1,
                assignedTo: 1,
                scholarshipName: '$scholarship.name'
            }}
        ]).toArray();

        // Enhance applications with display flags
        const enhancedApplications = applications.map(app => ({
            ...app,
            isAssignedToCurrentTester: app.assignedTo === req.session.testerId,
            isUnassigned: !app.assignedTo
        }));

        res.render('official_panel', { 
            applications: enhancedApplications,
            currentApplication: { isAssignedToCurrentTester: true }, // For modal actions
            helpers: {
                formatDate: function(date) {
                    return new Date(date).toLocaleDateString('en-IN');
                }
            }
        });
    } catch (error) {
        console.error("Error fetching applications:", error);
        res.status(500).send("An error occurred while fetching applications.");
    }
});

// Assign application route
router.post('/assign-application/:id', async (req, res) => {
    if (!req.session.testerId) {
        return res.status(401).json({ message: "Unauthorized. Please log in as a tester." });
    }
    try {
        const db = getDB();
        const applicationId = new ObjectId(req.params.id);
        
        const updateResult = await db.collection('applications').updateOne(
            { 
                _id: applicationId,
                status: 'pending',
                $or: [
                    { assignedTo: { $exists: false } },
                    { assignedTo: req.session.testerId }
                ]
            },
            { 
                $set: { 
                    assignedTo: req.session.testerId,
                    assignedAt: new Date() 
                } 
            }
        );
        
        if (updateResult.modifiedCount === 0) {
            return res.status(400).json({ message: "Application not found, already processed, or assigned to someone else" });
        }
        
        res.status(200).json({ message: "Application assigned successfully" });
    } catch (error) {
        console.error("Error assigning application:", error);
        res.status(500).json({ message: "An error occurred while assigning the application." });
    }
});

router.post('/certify-application/:id', async (req, res) => {
    if (!req.session.testerId) {
        return res.status(401).send("Unauthorized.");
    }
    try {
        const db = getDB();
        const application = await db.collection('applications').findOne({ _id: new ObjectId(req.params.id) });
        if (!application) {
            return res.status(404).send("Application not found.");
        }
        if (application.assignedTo && application.assignedTo !== req.session.testerId) {
            return res.status(403).send("This application is assigned to another tester.");
        }
        await db.collection('applications').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'certified', certifiedBy: req.session.testerId, certifiedAt: new Date() } }
        );
        res.redirect('/official-panel');
    } catch (error) {
        console.error("Error certifying application:", error);
        res.status(500).send("An error occurred while certifying the application.");
    }
});

router.post('/reject-application/:id', async (req, res) => {
    if (!req.session.testerId) {
        return res.status(401).send("Unauthorized.");
    }
    try {
        const db = getDB();
        const application = await db.collection('applications').findOne({ _id: new ObjectId(req.params.id) });
        if (!application) {
            return res.status(404).send("Application not found.");
        }
        if (application.assignedTo && application.assignedTo !== req.session.testerId) {
            return res.status(403).send("This application is assigned to another tester.");
        }
        const { reason } = req.body;
        await db.collection('applications').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'rejected', rejectionReason: reason, rejectedBy: req.session.testerId, rejectedAt: new Date() } }
        );
        res.redirect('/official-panel');
    } catch (error) {
        console.error("Error rejecting application:", error);
        res.status(500).send("An error occurred while rejecting the application.");
    }
});

router.delete('/delete-assignment/:id', async (req, res) => {
    if (!req.session.adminUsername) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    try {
        const db = getDB();
        const result = await db.collection('applications').deleteOne({
            _id: new ObjectId(req.params.id),
            status: { $in: ['certified', 'rejected'] } // Only allow deletion of processed applications
        });
        
        if (result.deletedCount === 0) {
            return res.status(400).json({ message: "Application not found or not in deletable state" });
        }
        
        res.status(200).json({ message: "Assignment record deleted successfully" });
    } catch (error) {
        console.error("Error deleting assignment:", error);
        res.status(500).json({ message: "An error occurred while deleting the assignment." });
    }
});
// Logout Route
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Error destroying session:", err);
            return res.status(500).send("An error occurred during logout.");
        }
        res.redirect('/');
    });
});

// Helper function to calculate scholarship status
function getScholarshipStatus(deadline) {
    if (!deadline) return "closed";
    const today = new Date();
    const deadlineDate = new Date(deadline);
    return deadlineDate >= today ? "open" : "closed";
}

module.exports = router;