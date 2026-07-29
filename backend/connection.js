const mongoose = require("mongoose");

async function connectToDB(url) {
  return mongoose.connect(url, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
}

module.exports = { connectToDB };
