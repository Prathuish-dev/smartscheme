const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const session = require('express-session'); // Import express-session
const { connectDB } = require('./db'); // Import the connectDB function
const indexRouter = require('./routes/index'); // Import the index router
const hbs = require('hbs'); // Import Handlebars

const app = express();

// Connect to MongoDB
connectDB();

// Session middleware
app.use(session({
    secret: 'your-secret-key', // Replace with a secure secret key
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Middleware to handle large file uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Register Handlebars helpers
hbs.registerHelper('isPast', function (deadline) {
    if (!deadline) return false;
    const currentDate = new Date();
    const scholarshipDeadline = new Date(deadline);
    return scholarshipDeadline < currentDate;
});

hbs.registerHelper('calculateOpenDate', function (deadline) {
    if (!deadline) return '';
    const deadlineDate = new Date(deadline);
    const openDate = new Date(deadlineDate);
    openDate.setMonth(deadlineDate.getMonth() + 11);
    return openDate.toISOString().split('T')[0]; // Format as YYYY-MM-DD
});

// Register Handlebars helper
hbs.registerHelper('isOwnScholarship', function (scholarshipID) {
    return scholarshipID === 155362; // Assuming 155362 is the ID for "Prof Joseph Mudassery Scholarship"
});

hbs.registerHelper('formatDate', function(date) {
    return new Date(date).toLocaleDateString('en-IN');
});

// Helper to split text into points based on newlines
hbs.registerHelper('splitPoints', function(text) {
    if (!text) return [];
    return text.split('\n').filter(point => point.trim() !== '');
});

// Helper to check if a point contains sub-points
hbs.registerHelper('containsSubPoints', function(point) {
    return point.includes(':') || point.match(/^\d+\./);
});

// Helper to split main point from sub-points
hbs.registerHelper('splitMainPoint', function(point) {
    return point.split(':')[0].trim();
});

// Helper to split sub-points
hbs.registerHelper('splitSubPoints', function(point) {
    const parts = point.split(':');
    if (parts.length > 1) {
        return parts[1].split('\n').filter(subPoint => subPoint.trim() !== '');
    }
    return [];
});

hbs.registerHelper('isCertified', function(status) {
    return status === 'certified';
});

hbs.registerHelper('isRejected', function(status) {
    return status === 'rejected';
});

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

// Middleware
app.use(logger('dev'));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from the "public" folder

// Routes
app.use('/', indexRouter); // Use the index router for all routes

// Catch 404 and forward to error handler
app.use(function (req, res, next) {
    next(createError(404));
});

// Error handler
app.use(function (err, req, res, next) {
    // Set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // Render the error page
    res.status(err.status || 500);
    res.render('error');
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

module.exports = app;