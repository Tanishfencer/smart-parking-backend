const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const User = require('../models/user.model');

const router = express.Router();

// Check email credentials
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

if (!EMAIL_USER || !EMAIL_PASS) {
  console.error('Email credentials missing:', {
    user: EMAIL_USER ? 'set' : 'missing',
    pass: EMAIL_PASS ? 'set' : 'missing'
  });
  throw new Error('Email credentials not properly configured');
}

console.log('Configuring email transport with:', {
  user: EMAIL_USER,
  pass: EMAIL_PASS ? '[HIDDEN]' : 'missing'
});

// Email transporter with updated Gmail settings
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  },
  debug: true,
  logger: true
});

// Test email configuration immediately
const testEmailConfig = async () => {
  try {
    console.log('Testing email configuration...');
    const verify = await transporter.verify();
    console.log('Email configuration verified:', verify);
    
    console.log('Sending test email...');
    const testInfo = await transporter.sendMail({
      from: {
        name: 'Smart Parking System',
        address: EMAIL_USER
      },
      to: EMAIL_USER,
      subject: 'Test Email',
      text: 'This is a test email to verify the email configuration.'
    });
    console.log('Test email sent successfully:', testInfo.messageId);
  } catch (error) {
    console.error('Email configuration error:', {
      name: error.name,
      message: error.message,
      code: error.code,
      command: error.command,
      response: error.response,
      stack: error.stack
    });
    throw error;
  }
};

// Test email configuration on startup
testEmailConfig().catch(error => {
  console.error('Failed to initialize email configuration:', error);
});

// Register
router.post('/register', async (req, res) => {
  try {
    console.log('Registration request received:', {
      email: req.body.email,
      hasPassword: !!req.body.password,
      body: req.body
    });

    const { email, password } = req.body;

    if (!email || !password) {
      console.log('Missing required fields:', { email: !!email, password: !!password });
      return res.status(400).json({ 
        success: false,
        message: 'Email and password are required' 
      });
    }

    console.log('Checking for existing user with email:', email);
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log('User already exists with email:', email);
      return res.status(400).json({ 
        success: false,
        message: 'Email already registered' 
      });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    console.log('Creating new user with verification token:', verificationToken);

    const user = new User({
      email,
      password,
      verificationToken,
      verificationTokenExpires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
    });

    try {
      await user.save();
      console.log('User saved successfully:', user._id);
    } catch (saveError) {
      console.error('Error saving user:', {
        error: saveError.message,
        validationErrors: saveError.errors
      });
      throw saveError;
    }

    // Construct verification URL without the hash
    const verificationUrl = `${process.env.FRONTEND_URL}/verify/${verificationToken}`;
    console.log('Sending verification email to:', email);
    console.log('Verification URL:', verificationUrl);

    try {
      await transporter.sendMail({
        from: {
          name: 'Smart Parking System',
          address: EMAIL_USER
        },
        to: email,
        subject: 'Verify Your Email',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Welcome to Smart Parking System!</h2>
            <p>Please click the link below to verify your email address:</p>
            <p>
              <a href="${verificationUrl}" style="padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">
                Verify Email
              </a>
            </p>
            <p>
              Or copy and paste this link in your browser:<br>
              ${verificationUrl}
            </p>
            <p>This link will expire in 24 hours.</p>
          </div>
        `
      });
      console.log('Verification email sent successfully');
    } catch (emailError) {
      console.error('Error sending verification email:', {
        error: emailError.message,
        code: emailError.code,
        response: emailError.response
      });
      throw emailError;
    }

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please check your email to verify your account.'
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during registration',
      error: error.message
    });
  }
});

// Verify email
router.get('/verify/:token', async (req, res) => {
  try {
    console.log('Verification request received:', {
      token: req.params.token,
      headers: req.headers,
      url: req.url
    });

    if (!req.params.token) {
      return res.status(400).json({
        success: false,
        message: 'Verification token is required'
      });
    }

    const user = await User.findOne({
      verificationToken: req.params.token,
      verificationTokenExpires: { $gt: Date.now() }
    });

    console.log('Verification attempt:', {
      tokenFound: !!user,
      userEmail: user ? user.email : 'not found',
      tokenExpired: user ? user.verificationTokenExpires < Date.now() : 'N/A',
      isVerified: user ? user.isVerified : 'N/A'
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token'
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email is already verified'
      });
    }

    // Update user verification status
    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    
    await user.save();
    
    console.log('User verified successfully:', user.email);

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully'
    });
  } catch (error) {
    console.error('Verification error:', {
      error: error.message,
      stack: error.stack,
      token: req.params.token
    });
    
    return res.status(500).json({
      success: false,
      message: 'An error occurred during verification'
    });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    console.log('Login attempt for email:', req.body.email);
    const { email, password } = req.body;
    
    // Find user and check verification status
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      console.log('User not found:', email);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      console.log('Invalid password for user:', email);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check verification status
    if (!user.isVerified) {
      console.log('Unverified user attempt:', email);
      return res.status(401).json({
        success: false,
        message: 'Please verify your email before logging in'
      });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: '24h'
    });

    console.log('Successful login for user:', email);
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      user: {
        id: user._id,
        email: user.email,
        isVerified: user.isVerified
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred during login',
      error: error.message
    });
  }
});

// Forgot password
router.post('/forgot-password', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
    await transporter.sendMail({
      to: user.email,
      subject: 'Password Reset Request',
      html: `Please click this link to reset your password: <a href="${resetUrl}">${resetUrl}</a>`
    });

    res.json({ message: 'Password reset email sent' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Reset password
router.post('/reset-password/:token', async (req, res) => {
  try {
    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
