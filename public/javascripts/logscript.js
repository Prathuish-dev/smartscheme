const container = document.getElementById('container');
const registerBtn = document.getElementById('register');
const loginBtn = document.getElementById('login');

// Toggle between sign-up and sign-in forms
registerBtn.addEventListener('click', () => {
    container.classList.add("active");
});

loginBtn.addEventListener('click', () => {
    container.classList.remove("active");
});

// Sign-Up Form Validation
const signupForm = document.getElementById('signup-form');
signupForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const aadhar = document.getElementById('aadhar').value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    // Validate Aadhar Number (16 digits)
    if (!/^\d{16}$/.test(aadhar)) {
        alert("Aadhar number must be 16 digits.");
        return;
    }

    // Validate Email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        alert("Please enter a valid email address.");
        return;
    }

    // Validate Password
    if (password.length < 8) {
        alert("Password must be at least 8 characters long.");
        return;
    }

    // Validate Confirm Password
    if (password !== confirmPassword) {
        alert("Passwords do not match.");
        return;
    }

    // If all validations pass, submit the form
    alert("Sign-Up Successful!");
    signupForm.reset();
});

// Login Form Validation
const loginForm = document.getElementById('login-form');
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    // Validate Email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        alert("Please enter a valid email address.");
        return;
    }

    // Validate Password
    if (password.length < 8) {
        alert("Password must be at least 8 characters long.");
        return;
    }

    // If all validations pass, submit the form
    alert("Login Successful!");
    loginForm.reset();
});