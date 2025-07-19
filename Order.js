const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  product: {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    image: { type: String },
  },
  quantity: { type: Number, required: true },
  fullName: { type: String, required: true },
  mobile: { type: String, required: true },
  email: { type: String },
  address: {
    country: String,
    pincode: String,
    flat: String,
    area: String,
    landmark: String,
    city: String,
    state: String,
    instructions: String
  },
  modeOfPayment: {
    type: String,
    enum: ['Credit Card', 'Debit Card', 'UPI', 'Net Banking', 'Cash on Delivery', 'Wallet', 'Other'],
    required: true
  },
  paymentUserName: { type: String },
  bankName: { type: String },
  transactionId: { type: String },
  paymentConfirmed: { type: Boolean, default: false },
  shippingMethod: { type: String },
  discount: {
    code: { type: String },
    amount: { type: Number }
  },
  createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', orderSchema);
module.exports = Order;
