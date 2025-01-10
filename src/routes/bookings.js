const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Booking = require('../models/booking');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Store OTPs temporarily (in production, use Redis or similar)
const otpStore = new Map();

// Email configuration
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Send OTP for booking verification
router.post('/send-otp', async (req, res) => {
  try {
    console.log('Received OTP request:', req.body);
    const { email, bookingDetails } = req.body;

    if (!email || !bookingDetails) {
      console.log('Missing required fields:', { email: !!email, bookingDetails: !!bookingDetails });
      return res.status(400).json({
        success: false,
        message: 'Email and booking details are required'
      });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiryTime = Date.now() + 10 * 60 * 1000; // 10 minutes

    console.log('Generated OTP details:', {
      email,
      otp,
      expiryTime: new Date(expiryTime).toISOString(),
      bookingDetails
    });

    // Store OTP
    otpStore.set(email, {
      otp,
      expiryTime,
      bookingDetails
    });

    console.log('OTP stored successfully. Current store contents:', Array.from(otpStore.entries()));

    // Send email
    await transporter.sendMail({
      from: {
        name: 'Smart Parking System',
        address: process.env.EMAIL_USER
      },
      to: email,
      subject: 'Parking Spot Booking Verification',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Verify Your Parking Spot Booking</h2>
          <p>Your verification code is: <strong>${otp}</strong></p>
          <p>This code will expire in 10 minutes.</p>
          <p>Booking Details:</p>
          <ul>
            <li>Spot: ${bookingDetails.spotId}</li>
            <li>Vehicle: ${bookingDetails.registrationNumber}</li>
            <li>Start Time: ${bookingDetails.startTime}</li>
            <li>End Time: ${bookingDetails.endTime}</li>
          </ul>
        </div>
      `
    });

    console.log('OTP sent successfully to:', email);
    res.json({
      success: true,
      message: 'OTP sent successfully'
    });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      error: error.message
    });
  }
});

// Verify OTP and create booking
router.post('/verify-otp', async (req, res) => {
  try {
    console.log('Received OTP verification request:', req.body);
    const { email, otp } = req.body;

    if (!email || !otp) {
      console.log('Missing required fields:', { email: !!email, otp: !!otp });
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required'
      });
    }

    console.log('Checking OTP store for email:', email);
    console.log('Current OTP store contents:', Array.from(otpStore.entries()));
    
    const storedData = otpStore.get(email);
    console.log('Stored data for email:', storedData);
    
    if (!storedData) {
      console.log('No OTP found for email:', email);
      return res.status(400).json({
        success: false,
        message: 'No OTP found for this email'
      });
    }

    console.log('Comparing OTPs:', { 
      provided: otp, 
      stored: storedData.otp,
      expiryTime: new Date(storedData.expiryTime).toISOString(),
      currentTime: new Date().toISOString(),
      isExpired: Date.now() > storedData.expiryTime
    });

    if (Date.now() > storedData.expiryTime) {
      console.log('OTP has expired');
      otpStore.delete(email);
      return res.status(400).json({
        success: false,
        message: 'OTP has expired'
      });
    }

    if (storedData.otp !== otp) {
      console.log('Invalid OTP provided');
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    console.log('OTP verified successfully, creating booking with details:', storedData.bookingDetails);
    
    // Convert time strings to Date objects
    const today = new Date();
    const [startHours, startMinutes] = storedData.bookingDetails.startTime.split(':');
    const [endHours, endMinutes] = storedData.bookingDetails.endTime.split(':');
    
    const startTime = new Date(today);
    startTime.setHours(parseInt(startHours), parseInt(startMinutes), 0);
    
    const endTime = new Date(today);
    endTime.setHours(parseInt(endHours), parseInt(endMinutes), 0);

    // Calculate total cost (1 hour = $10)
    const hours = (endTime - startTime) / (1000 * 60 * 60);
    const totalCost = Math.ceil(hours * 10);
    
    // Create booking with correct field mapping
    const booking = new Booking({
      userId: new mongoose.Types.ObjectId(), // Generate a new ObjectId without conversion
      spotId: storedData.bookingDetails.spotId,
      vehicleNumber: storedData.bookingDetails.registrationNumber,
      startTime: startTime,
      endTime: endTime,
      totalCost: totalCost,
      status: 'confirmed'
    });

    await booking.save();
    
    // Clear OTP
    otpStore.delete(email);

    console.log('Booking created successfully:', booking);
    res.json({
      success: true,
      message: 'Booking confirmed successfully',
      booking
    });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP',
      error: error.message
    });
  }
});

// Get active booking for a user
router.get('/active/:userId', async (req, res) => {
  try {
    const currentTime = new Date();
    const activeBooking = await Booking.findOne({
      userId: mongoose.Types.ObjectId(req.params.userId),
      endTime: { $gt: currentTime },
      status: 'confirmed'
    });

    res.json({
      success: true,
      hasActiveBooking: !!activeBooking,
      booking: activeBooking
    });
  } catch (error) {
    console.error('Error checking active booking:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to check active booking',
      error: error.message 
    });
  }
});

// Create new booking
router.post('/', async (req, res) => {
  try {
    console.log('Creating new booking:', req.body);
    const { userId, spotId, vehicleNumber, startTime, endTime, totalCost } = req.body;
    
    if (!userId || !spotId || !vehicleNumber || !startTime || !endTime) {
      return res.status(400).json({ 
        success: false,
        message: 'Missing required booking fields' 
      });
    }

    // Check for active bookings
    const hasActiveBooking = await Booking.findOne({
      userId: mongoose.Types.ObjectId(userId),
      endTime: { $gt: new Date() },
      status: 'confirmed'
    });

    if (hasActiveBooking) {
      return res.status(400).json({ 
        success: false,
        message: 'User already has an active booking' 
      });
    }

    const booking = new Booking({
      userId: new mongoose.Types.ObjectId(userId),
      spotId,
      vehicleNumber,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      totalCost,
      status: 'confirmed'
    });

    await booking.save();
    console.log('Booking created successfully:', booking);
    
    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      booking
    });
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to create booking',
      error: error.message 
    });
  }
});

// Cancel booking
router.post('/:bookingId/cancel', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId);
    if (!booking) {
      return res.status(404).json({ 
        success: false,
        message: 'Booking not found' 
      });
    }

    booking.status = 'cancelled';
    await booking.save();
    console.log('Booking cancelled successfully:', booking);
    
    res.json({
      success: true,
      message: 'Booking cancelled successfully',
      booking
    });
  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to cancel booking',
      error: error.message 
    });
  }
});

// Get user's booking history
router.get('/history/:userId', async (req, res) => {
  try {
    console.log('Fetching booking history for user:', req.params.userId);
    
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
      console.log('Invalid user ID format:', req.params.userId);
      return res.status(400).json({ 
        success: false,
        message: 'Invalid user ID format' 
      });
    }

    console.log('Querying database for bookings...');
    const bookings = await Booking.find({
      userId: mongoose.Types.ObjectId(req.params.userId)
    })
    .sort({ startTime: -1 })
    .lean();

    console.log(`Found ${bookings.length} bookings for user:`, req.params.userId);
    console.log('Bookings:', JSON.stringify(bookings, null, 2));
    
    res.json({
      success: true,
      bookings: bookings
    });
  } catch (error) {
    console.error('Error fetching booking history:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch booking history',
      error: error.message 
    });
  }
});

module.exports = router;
