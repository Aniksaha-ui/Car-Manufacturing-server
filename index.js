const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.kwnxt.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

//verify jwt token
function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "UnAuthorized access" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
}

async function run() {
  await client.connect();
  const partsCollection = client.db("Manufacturing").collection("parts");
  const userCollection = client.db("Manufacturing").collection("users");
  const purchaseCollection = client.db("Manufacturing").collection("purchase");
  const reviewCollection = client.db("Manufacturing").collection("review");
  const paymentCollection = client.db("Manufacturing").collection("payments");

  //verify admin
  const verifyAdmin = async (req, res, next) => {
    const requester = req.decoded.email;
    console.log(requester);
    const requesterAccount = await userCollection.findOne({ email: requester });
    if (requesterAccount.role === "admin") {
      next();
    } else {
      res.status(403).send({ message: "forbidden" });
    }
  };

  try {
    // parts
    app.post("/parts", verifyJWT, verifyAdmin, async (req, res) => {
      const parts = req.body;
      const result = await partsCollection.insertOne(parts);
      res.send(result);
    });

    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const purchase = req.body;
      const price = purchase.price;
      const amount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    //store payment

    app.patch("/purchase/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const payment = req.body;
      const filter = { _id: ObjectId(id) };
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };

      const result = await paymentCollection.insertOne(payment);
      const updatedPurchase = await purchaseCollection.updateOne(
        filter,
        updatedDoc
      );
      res.send(updatedPurchase);
    });

    // find all parts
    app.get("/parts", async (req, res) => {
      const query = {};
      const parts = await partsCollection.find(query).toArray();
      res.send(parts);
    });

    app.get("/parts/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if (email === decodedEmail) {
        const query = { _id: ObjectId(id) };
        const parts = await partsCollection.findOne(query);
        res.send(parts);
      } else {
        res.status(403).send({ message: "Access Forbidden" });
      }
    });

    //parts end

    //review
    app.post("/reviews", verifyJWT, async (req, res) => {
      const review = req.body;
      const result = await reviewCollection.insertOne(review);
      res.send(result);
    });

    app.get("/review", async (req, res) => {
      const query = {};
      const result = await reviewCollection.find(query).toArray();
      res.send(result);
    });
    //review

    //purchase
    app.post("/purchase", verifyJWT, async (req, res) => {
      const purchase = req.body;
      const result = await purchaseCollection.insertOne(purchase);
      res.send(result);
    });

    //all purchase for admin
    app.get("/purchase", verifyJWT, verifyAdmin, async (req, res) => {
      const purchase = await purchaseCollection.find().toArray();
      res.send(purchase);
    });

    //purchase

    //mypurchase
    app.get("/mypurchse", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if (email === decodedEmail) {
        const query = { email: email };
        const purchase = await purchaseCollection.find(query).toArray();
        return res.send(purchase);
      } else {
        return res.status(403).send({ message: "forbidden access" });
      }
    });

    //find information by purchase id
    app.get("/purchase/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const booking = await purchaseCollection.findOne(query);
      res.send(booking);
    });

    //mypurchase end

    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === "admin";
      // console.log(email);
      res.send({ admin: isAdmin });
    });

    //delete purchase
    app.delete("/purchase/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const result = await purchaseCollection.deleteOne(filter);
      res.send(result);
    });

    //users
    app.get("/user", verifyJWT, verifyAdmin, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    //make a person admin
    app.put("/user/admin/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updateDoc = {
        $set: { role: "admin" },
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    //login or register
    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" }
      );
      res.send({ result, token });
    });

    //profile update
    app.put("/profile", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const user = req.body;
      // console.log(email);
      const filter = { email: email };
      const updatedDoc = {
        $set: user,
      };
      const updatedProfile = await userCollection.updateOne(filter, updatedDoc);
      res.send(updatedProfile);
    });

    //profile update done
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(` listening on port ${port}`);
});
