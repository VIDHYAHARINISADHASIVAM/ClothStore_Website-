const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true },
  subcategory: { type: String },
  quantity: { type: Number, default: 0 },
  price: { type: Number, required: true },
  description: { type: String },
  image: { type: String, required: true },
  supplier: {
    name: String,
    contact: String
  }
});

module.exports = mongoose.model('Product', productSchema);
