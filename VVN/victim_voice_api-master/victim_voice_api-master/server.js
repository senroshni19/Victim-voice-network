require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const dotenv = require('dotenv');
const cors = require('cors');
const { sendMessage } = require('./utils/sendMessage');
const jwt = require('jsonwebtoken');


const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB connection
const mongoClient = new MongoClient(process.env.MONGO_URI);
let supportRequestsCollection;
let usersCollection;
let otpCollection;

mongoClient.connect().then(() => {
  console.log('MongoDB connection successful');
  const db = mongoClient.db(process.env.DATABASE_NAME);
  supportRequestsCollection = db.collection('supportRequests');
  usersCollection = db.collection('users');
  otpCollection = db.collection('otps');
}).catch(err => {
  console.error('MongoDB connection failed:', err.message);
});

// Middleware to verify JWT
const authenticateJWT = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]; // Authorization: Bearer <token>

  if (token) {
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.sendStatus(403); // Forbidden if JWT is invalid
      }
      req.user = user;
      next();
    });
  } else {
    res.sendStatus(401); // Unauthorized if no token is provided
  }
};

// Example usage of middleware
app.get('/protected-route', authenticateJWT, (req, res) => {
  res.json({ message: 'Access to protected route granted' });
});


app.post('/auth/send-otp', async (req, res) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber) return res.status(400).json({ error: 'Phone number is required' });

  const otp = Math.floor(100000 + Math.random() * 900000); // Generate 6-digit OTP
  const message = `Your OTP code is ${otp}`;

  try {
    // Send OTP using Twilio
    // const twilioResponse = await sendMessage(message, phoneNumber);
    // if (twilioResponse.status !== 'accepted') throw new Error('Failed to send OTP');

    const otp = 123456; // For testing purposes, use a fixed OTP

    // Save OTP to the database with expiry
    await otpCollection.insertOne({
      phoneNumber,
      otp,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60000) // OTP expires in 5 minutes
    });

    res.json({ message: 'OTP sent successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error sending OTP', details: error.message });
  }
});

// Route to verify OTP
app.post('/auth/verify-otp', async (req, res) => {
  const { phoneNumber, otp } = req.body;
  if (!phoneNumber || !otp) return res.status(400).json({ error: 'Phone number and OTP are required' });

  try {
    // Attempt to find the OTP record
    const record = await otpCollection.findOne({ phoneNumber, otp: parseInt(otp) });

    console.log('OTP Record:', record);  // Debugging log to check the OTP record

    if (!record) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }
    
    // Check if OTP has expired
    if (record.expiresAt < new Date()) {
      await otpCollection.deleteOne({ _id: record._id });
      return res.status(400).json({ error: 'OTP expired' });
    }

    // Check if the user exists, if not, create a new user
    let user = await usersCollection.findOne({ phoneNumber });
    if (!user) {
      const newUser = { phoneNumber, createdAt: new Date() };
      const result = await usersCollection.insertOne(newUser);
      user = result.ops[0]; // Assuming MongoDB 3.6+, otherwise use result.insertedId
    }

    // Generate JWT token
    const token = jwt.sign({ userId: user._id, phoneNumber: user.phoneNumber }, JWT_SECRET, {
      expiresIn: '12h', // Token expiry (e.g., 12 hour)
    });

    // Send JWT token to the frontend
    res.json({ success: true, token, message: 'OTP verified successfully' });

    // Remove OTP from database after verification
    await otpCollection.deleteOne({ _id: record._id });
    
  } catch (error) {
    console.error('Error verifying OTP:', error);  // Log the error for debugging
    res.status(500).json({ error: 'Error verifying OTP', details: error.message });
  }
});

app.put('/support-requests/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Status is required' });

    const result = await supportRequestsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );

    if (result.modifiedCount > 0) {
      res.json({ success: true, message: 'Support request updated' });
    } else {
      res.status(404).json({ error: 'Support request not found' });
    }
  } catch (error) {
    res.status(500).send('Error updating support request: ' + error.message);
  }
});


app.post('/support-requests', async (req, res) => {
  try {
    // Extract JWT token from the Authorization header
    const token = req.headers.authorization?.split(' ')[1]; // Get the token from 'Bearer token'
    if (!token) {
      return res.status(403).json({ error: 'No token provided' });
    }

    // Verify the token and extract user ID
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId; // Assuming the user ID is in the payload

    const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
    const userPhoneNumber = user.phoneNumber;

    // Extract form data from the request body
    const { userAddress, accusedAddress, accusedName, harassmentType, severityLevel, description, screenshotEvidence, videoEvidence, accusedPhone } = req.body;

    // Basic validation
    if (!userAddress || !accusedAddress || !accusedName || !harassmentType || !severityLevel || !description) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const status = 'Pending'; // Default status for new support requests

    const screenshotObject = screenshotEvidence ? { url: screenshotEvidence, type: 'screenshot' } : null;
    const videoObject = videoEvidence ? { url: videoEvidence, type: 'video' } : null;
    const supportRequest = {
      userId, 
      userAddress,
      accusedAddress,
      accusedName,
      status,
      harassmentType,
      phone : userPhoneNumber,
      accusedPhone,
      severityLevel,
      evidence : [ screenshotObject, videoObject ],
      description,
      createdAt: new Date(),
      comments: [], 
    };

    const result = await supportRequestsCollection.insertOne(supportRequest);
    res.status(200).json({ message: 'Support request saved successfully', id: result.insertedId });
  } catch (error) {
    console.error('Error saving support request:', error.message);
    res.status(500).send('Error saving support request: ' + error.message);
  }
});


app.get('/support-requests', async (req, res) => {
  try {
    const requests = await supportRequestsCollection.find().toArray();
    res.status(200).json(requests);
  } catch (error) {
    console.error('Error fetching support requests:', error.message);
    res.status(500).json({ error: 'Error fetching support requests' });
  }
});

app.get('/support-requests/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const supportRequest = await supportRequestsCollection.findOne({ _id: new ObjectId(id) });

    if (!supportRequest) {
      return res.status(404).json({ error: 'Support request not found' });
    }

    res.status(200).json(supportRequest);
  } catch (error) {
    console.error('Error fetching support request:', error.message);
    res.status(500).json({ error: 'Error fetching support request' });
  }
});

app.get('/admin-support-requests', async (req, res) => {
  try {
    //check if the user is an admin
    const token = req.headers.authorization?.split(' ')[1]; // Get the token from 'Bearer token'
    if (!token) {
      return res.status(403).json({ error: 'No token provided' });
    }
    //check if the id of the user is the same as the id of the admin
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId; // Assuming the user ID is in the payload
    if (userId !== process.env.ADMIN_ID) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }
    const requests = await supportRequestsCollection.find().toArray();
    res.status(200).json(requests);
  } catch (error) {
    console.error('Error fetching support requests:', error);
    res.status(500).json({ error: 'Error fetching support requests' });
  }
});

app.get('/support-requests/user/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const requests = await supportRequestsCollection.find({ userId }).toArray();
    res.status(200).json(requests);
  } catch (error) {
    console.error('Error fetching support requests:', error.message);
    res.status(500).json({ error: 'Error fetching support requests' });
  }
});


app.get('/support-requests-ids', async (req, res) => {
  try {
    const requests = await supportRequestsCollection.find().project({ _id: 1 }).toArray();
    res.status(200).json(requests.map(r => r._id));
  } catch (error) {
    console.error('Error fetching support request IDs:', error.message);
    res.status(500).json({ error: 'Error fetching support request IDs' });
  }
});

app.post('/create-admin', async (req, res) => {
  try {
    const { name, email, password,securityKey } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (securityKey !== process.env.SECURITY_KEY) {
      return res.status(403).json({ error: 'Invalid security key' });
    }

    const admin = {
      name,
      email,
      password,
      role: 'admin',
      createdAt: new Date(),
    };

    const result = await usersCollection.insertOne(admin);
    res.status(200).json({ message: 'Admin created successfully', id: result.insertedId });
  } catch (error) {
    console.error('Error creating admin:', error.message);
    res.status(500).json({ error: 'Error creating admin' });
  }
});

app.post('/adminlogin', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const admin = await usersCollection.findOne({ email, password, role: 'admin' });
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    const token = jwt.sign({ userId: admin._id, email: admin.email }, JWT_SECRET, {
      expiresIn: '30d', // Token expiry (e.g., 30 days)
    });

    res.json({ success: true, token, message: 'Admin logged in successfully' });
  } catch (error) {
    console.error('Error logging in admin:', error.message);
    res.status(500).json({ error: 'Error logging in admin' });
  }
});

// Route to add a comment to a support request
app.post('/support-requests/:id/comment', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Comment text is required' });

    //pull the user id from the token
    const token = req.headers.authorization?.split(' ')[1]; // Get the token from 'Bearer token'
    if (!token) {
      return res.status(403).json({ error: 'No token provided' });
    }

    // Verify the token and extract user ID
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId; // Assuming the user ID is in the payload
    //compare the user id with the id of the admin in env 
    // and if they are not the same make sender as "user"
    // else make sender as "admin"
    const sender = userId === process.env.ADMIN_ID ? 'admin' : 'user';

    const comment = {
      id : new ObjectId(),
      sender,
      content: text,
      timestamp: new Date().toISOString(),
    };

    const result = await supportRequestsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $push: { comments: comment } }
    );

    if (result.modifiedCount > 0) {
      res.json({ success: true, message: 'Comment added' });
    } else {
      res.status(404).json({ error: 'Support request not found' });
    }
  } catch (error) {
    res.status(500).send('Error adding comment: ' + error.message);
  }
});

app.put('/update-status/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Status is required' });
    const token = req.headers.authorization?.split(' ')[1]; // Get the token from 'Bearer token'
    if (!token) {
      return res.status(403).json({ error: 'No token provided' });
    }
    //check if the id of the user is the same as the id of the admin
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId; // Assuming the user ID is in the payload
    if (userId !== process.env.ADMIN_ID) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }

    const result = await supportRequestsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );

    if (result.modifiedCount > 0) {
      res.json({ success: true, message: 'Support request updated' });
    } else {
      res.status(404).json({ error: 'Support request not found' });
    }
  } catch (error) {
    res.status(500).send('Error updating support request: ' + error.message);
  }
});

// Route to remove a comment from a support request
app.delete('/support-requests/:id/comment', async (req, res) => {
  try {
    const { index } = req.body;
    if (index === undefined) return res.status(400).json({ error: 'Comment index is required' });

    const result = await supportRequestsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $unset: { [`comments.${index}`]: 1 } }
    );

    // Remove null values left by unset operation
    await supportRequestsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $pull: { comments: null } }
    );

    if (result.modifiedCount > 0) {
      res.json({ success: true, message: 'Comment removed' });
    } else {
      res.status(404).json({ error: 'Support request not found or index invalid' });
    }
  } catch (error) {
    res.status(500).send('Error removing comment: ' + error.message);
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
