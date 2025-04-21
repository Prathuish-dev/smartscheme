// mailer.js
const nodemailer = require('nodemailer');

// Create a transporter object using SMTP
const transporter = nodemailer.createTransport({
    service: 'gmail', // Use Gmail as the email service
    host: 'smtp.gmail.com', // Gmail's SMTP server host
    port: 587, // Port for TLS/STARTTLS
    auth: {
        user: 'your-email', // Your Gmail address
        pass: 'your-password', // Your Gmail password or app-specific password
    },
});

// Function to send an email
const sendEmail = (to, subject, text) => {
    const mailOptions = {
        from:{
                name: 'Smartscheme',
                address: 'your-email address'
        },
        to: to, 
        subject: subject, 
        text: text, 
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Error sending email:', error);
        } else {
            console.log('Email sent:', info.response);
        }
    });
};

module.exports = sendEmail;
