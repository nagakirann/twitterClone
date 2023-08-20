const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const databasePath = path.join(__dirname, "twitterClone.db");
let database = null;
const initializeAndDbAndServer = async () => {
  try {
    database = await open({ filename: databasePath, driver: sqlite3.Database });
    app.listen(3000, () => {
      console.log(`server is running on http://localhost:3000`);
    });
  } catch (error) {
    console.log(`Database error is ${error}`);
    process.exit(1);
  }
};
initializeAndDbAndServer();

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const userDetailsQuery = `select * from user where username = '${username}';`;
  const userDetails = await database.get(userDetailsQuery);
  if (userDetails !== undefined) {
    const isPasswordValid = await bcrypt.compare(
      password,
      userDetails.password
    );
    if (isPasswordValid) {
      //get JWT Token
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "secret_key");
      response.send({ jwtToken }); //Scenario 3
    } else {
      response.status(400);
      response.send("Invalid password"); //Scenario 2
    }
  } else {
    response.status(400);
    response.send("Invalid user"); //Scenario 1
  }
});

//authentication

function authenticationToken(request, response, next) {
  let jwtToken;
  const authHeader = request.headers.authorization;
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken !== undefined) {
    jwt.verify(jwtToken, "secret_key", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token"); // Scenario 1
      } else {
        next(); //Scenario 2
      }
    });
  } else {
    response.status(401);
    response.send("Invalid JWT Token"); //Scenario 1
  }
}

//API 1 register user
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const checkUserQuery = `SELECT username FROM user WHERE username = '${username}';`;
  const checkUserResponse = await database.get(checkUserQuery);

  if (checkUserResponse === undefined) {
    const createUserQuery = `
      INSERT INTO user(username,password,name,gender) 
      VALUES('${username}','${hashedPassword}', '${name}', '${gender}');
    `;

    if (password.length > 6) {
      const createUser = await database.run(createUserQuery);
      response.send("User created successfully");
    } else {
      response.status(400).send("Password is too short");
    }
  } else {
    response.status(400).send("User already exists");
  }
});

app.get("/user/tweet/feed/", authenticationToken, async (req, res) => {
  const username = req.user.username;
  console.log(username);
  const query = `
    SELECT t.username, t.tweet, t.dateTime
FROM tweet AS t
INNER JOIN follower AS f ON t.username = f.followed_username
WHERE f.follower_username = ?
ORDER BY t.dateTime DESC
LIMIT 4;

  `;

  try {
    const tweet = await new Promise((resolve, reject) => {
      database.all(query, [username], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });

    res.json(tweet);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "An error occurred" });
  }
});

//API 4
app.get("/user/following/", authenticationToken, async (req, res) => {
  const followerUsername = req.user.username; // Assuming you have the user object in the request

  // Your database query to get the list of names of people whom the user follows
  const query = `
    SELECT u.name
    FROM user AS u
    INNER JOIN follower AS f ON u.username = f.followed_username
    WHERE f.follower_username = ?;
  `;

  try {
    const followingNames = await new Promise((resolve, reject) => {
      database.all(query, [followerUsername], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });

    const names = followingNames.map((row) => row.name);
    res.json(names);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "An error occurred" });
  }
});

//API 5
app.get("/user/followers/", authenticationToken, async (req, res) => {
  const followedUsername = req.user.username; // Assuming you have the user object in the request

  // Your database query to get the list of names of people who follow the user
  const query = `
    SELECT u.name
    FROM user AS u
    INNER JOIN follower AS f ON u.username = f.follower_username
    WHERE f.followed_username = ?;
  `;

  try {
    const followerNames = await new Promise((resolve, reject) => {
      database.all(query, [followedUsername], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });

    const names = followerNames.map((row) => row.name);
    res.json(names);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "An error occurred" });
  }
});

//api 6

app.get("/tweets/:tweetId/", authenticationToken, async (req, res) => {
  const username = req.user.username;
  const tweetId = req.params.tweetId;
  const query = `
    SELECT t.tweet, 
           COUNT(l.id) AS likes,
           COUNT(r.id) AS replies,
           t.dateTime
    FROM tweet AS t
    LEFT JOIN like AS l ON t.id = l.tweet_id
    LEFT JOIN reply AS r ON t.id = r.tweet_id
    WHERE t.id = ? AND (t.username = ? OR EXISTS (
      SELECT 1
      FROM follower AS f
      WHERE f.follower_username = ? AND f.followed_username = t.username
    ))
    GROUP BY t.id;
  `;

  try {
    const tweetDetails = await new Promise((resolve, reject) => {
      database.get(query, [tweetId, username, username], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });

    if (tweetDetails) {
      res.json({
        tweet: tweetDetails.tweet,
        likes: tweetDetails.likes,
        replies: tweetDetails.replies,
        dateTime: tweetDetails.dateTime,
      });
    } else {
      res.status(401).send("Invalid Request");
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "An error occurred" });
  }
});

//api 7
app.get("/tweets/:tweetId/likes/", authenticationToken, async (req, res) => {
  const username = req.user.username; // Assuming you have the user object in the request
  const tweetId = req.params.tweetId;

  // Your database query to get the list of usernames who liked the tweet
  const query = `
    SELECT u.username
    FROM user AS u
    INNER JOIN like AS l ON u.username = l.username
    INNER JOIN tweet AS t ON l.tweet_id = t.id
    WHERE t.id = ? AND (t.username = ? OR EXISTS (
      SELECT 1
      FROM follower AS f
      WHERE f.follower_username = ? AND f.followed_username = t.username
    ));
  `;

  try {
    const likedUsernames = await new Promise((resolve, reject) => {
      database.all(query, [tweetId, username, username], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const usernames = rows.map((row) => row.username);
          resolve(usernames);
        }
      });
    });

    if (likedUsernames.length > 0) {
      res.json({ likes: likedUsernames });
    } else {
      res.status(401).send("Invalid Request");
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "An error occurred" });
  }
});

//api 8
app.get("/tweets/:tweetId/replies/", authenticationToken, async (req, res) => {
  const username = req.user.username; // Assuming you have the user object in the request
  const tweetId = req.params.tweetId;

  // Your database query to get the list of replies to the tweet
  const query = `
    SELECT u.name, r.reply
    FROM user AS u
    INNER JOIN reply AS r ON u.username = r.username
    INNER JOIN tweet AS t ON r.tweet_id = t.id
    WHERE t.id = ? AND (t.username = ? OR EXISTS (
      SELECT 1
      FROM follower AS f
      WHERE f.follower_username = ? AND f.followed_username = t.username
    ));
  `;

  try {
    const replies = await new Promise((resolve, reject) => {
      database.all(query, [tweetId, username, username], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });

    if (replies.length > 0) {
      res.json({ replies });
    } else {
      res.status(401).send("Invalid Request");
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "An error occurred" });
  }
});

//api 9
app.get("/user/tweets/", authenticationToken, async (req, res) => {
  const username = req.user.username;

  const query = `
    SELECT t.tweet, 
           COUNT(l.id) AS likes,
           COUNT(r.id) AS replies,
           t.dateTime
    FROM tweet AS t
    LEFT JOIN like AS l ON t.id = l.tweet_id
    LEFT JOIN reply AS r ON t.id = r.tweet_id
    WHERE t.username = ?
    GROUP BY t.id
    ORDER BY t.dateTime DESC;
  `;

  try {
    const userTweets = await new Promise((resolve, reject) => {
      database.all(query, [username], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });

    res.json(userTweets);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "An error occurred" });
  }
});

//api 10
app.post("/user/tweets/", authenticationToken, async (req, res) => {
  const username = req.user.username;
  const { tweet } = req.body;

  const insertQuery = `
    INSERT INTO tweet (username, tweet, dateTime)
    VALUES (?, ?, datetime('now'));
  `;

  try {
    await new Promise((resolve, reject) => {
      database.run(insertQuery, [username, tweet], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    res.send("Created a Tweet");
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "An error occurred" });
  }
});

//api 11

app.delete("/tweets/:tweetId/", authenticationToken, async (req, res) => {
  const username = req.user.username; // Assuming you have the user object in the request
  const tweetId = req.params.tweetId;

  // Your database query to delete the tweet
  const deleteQuery = `
    DELETE FROM tweet
    WHERE id = ? AND username = ?;
  `;

  try {
    const result = await new Promise((resolve, reject) => {
      database.run(deleteQuery, [tweetId, username], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);        }
      });
    });

    if (result > 0) {
      res.send("Tweet Removed");
    } else {
      res.status(401).send("Invalid Request");
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "An error occurred" });
  }
});

module.exports = app;
