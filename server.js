const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const Product = require('./models/Product');
const Order = require('./models/Order');
const User = require('./models/User');
const otpGenerator = require('otp-generator');
const twilio = require('twilio');
const accountSid = 'YOUR_TWILIO_ACCOUNT_SID';
const authToken = 'YOUR_TWILIO_AUTH_TOKEN';
const twilioPhone = 'YOUR_TWILIO_PHONE_NUMBER';
const client = twilio(accountSid, authToken);

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/clothstoreDB')
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.error(err));

// USER REGISTRATION
app.post('/api/register', async (req, res) => {
  try {
    const existing = await User.findOne({ email: req.body.email });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered. Please log in or use a different email.' });
    }
    const newUser = new User({
      ...req.body,
      isActivated: true, // Activate immediately
      otp: undefined,
      otpExpires: undefined
    });
    await newUser.save();
    res.status(201).json({ message: 'Registration successful! You can now log in.' });
  } catch (err) {
    // Handle duplicate key error
    if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
      return res.status(400).json({ error: 'Email already registered. Please log in or use a different email.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// OTP Verification
app.post('/api/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.isActivated) return res.status(400).json({ error: 'Account already activated' });
  if (user.otp !== otp || !user.otpExpires || user.otpExpires < Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }
  user.isActivated = true;
  user.otp = undefined;
  user.otpExpires = undefined;
  await user.save();
  res.json({ message: 'Account activated! You can now log in.' });
});

// USER LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    // Check lockout
    if (user.lockUntil && user.lockUntil > Date.now()) {
      return res.status(403).json({ message: 'Account locked. Try again later.' });
    }
    // Check activation
    if (!user.isActivated) {
      return res.status(403).json({ message: 'Account not activated. Please verify OTP.' });
    }
    // Check password
    if (user.password !== password) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= 3) {
        user.lockUntil = Date.now() + 10 * 60 * 1000; // lock for 10 min
        await user.save();
        return res.status(403).json({ message: 'Account locked after 3 failed attempts. Try again later.' });
      }
      await user.save();
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    // Success: reset attempts
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();
    res.json({ message: 'Login successful', role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SEND OTP
let otpStore = {};

app.post('/api/send-otp', async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: "User not found" });

  const otp = otpGenerator.generate(6, { digits: true, alphabets: false, upperCase: false, specialChars: false });
  otpStore[email] = otp;

  console.log(`OTP for ${email}: ${otp}`);
  res.status(200).json({ message: "OTP sent to registered email (mocked)", otp });
});

app.post('/api/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (otpStore[email] !== otp) return res.status(400).json({ error: "Invalid OTP" });

  await User.findOneAndUpdate({ email }, { password: newPassword });
  delete otpStore[email];
  res.status(200).json({ message: "Password updated successfully" });
});

// PRODUCT CRUD
app.post('/api/products', async (req, res) => {
  try {
    const newProduct = new Product(req.body);
    await newProduct.save();
    res.status(201).json({ message: 'Product added successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const { category, subcategory, search } = req.query;
    let query = {};

    if (category) query.category = category;
    if (subcategory) query.subcategory = subcategory;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
        { subcategory: { $regex: search, $options: 'i' } }
      ];
    }

    const products = await Product.find(query);
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    await Product.findByIdAndUpdate(req.params.id, req.body);
    res.json({ message: 'Product updated successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: 'Product deleted successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PLACE ORDER
app.post('/api/orders', async (req, res) => {
  try {
    const { product, quantity } = req.body;
    // Find product by name (or ideally by _id if available)
    const dbProduct = await Product.findOne({ name: product.name });
    if (!dbProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }
    if (dbProduct.quantity < quantity) {
      return res.status(400).json({ error: 'Out of stock' });
    }
    dbProduct.quantity -= quantity;
    await dbProduct.save();
    const order = new Order(req.body);
    await order.save();
    res.status(201).json({ message: 'Order placed successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// WISHLIST ENDPOINTS
// Add to wishlist
app.post('/api/wishlist/add', async (req, res) => {
  const { email, productId } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.wishlist.includes(productId)) {
    user.wishlist.push(productId);
    await user.save();
  }
  res.json({ message: 'Added to wishlist' });
});
// Remove from wishlist
app.post('/api/wishlist/remove', async (req, res) => {
  const { email, productId } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.wishlist = user.wishlist.filter(id => id.toString() !== productId);
  await user.save();
  res.json({ message: 'Removed from wishlist' });
});
// Get wishlist
app.get('/api/wishlist', async (req, res) => {
  const { email } = req.query;
  const user = await User.findOne({ email }).populate('wishlist');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user.wishlist);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
