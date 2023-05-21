const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const dbPath = path.join(__dirname, "twitterClone.db");
let database;
const app = express();
app.use(express.json());

const initializeDBAndServer = async () => {
  try {
    database = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server is Running at http://localhost:3000");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    progress.exit(1);
  }
};

initializeDBAndServer();

const getUserId = async (request, response, next) => {
  const { username } = request;
  const getUserIdQuery = `
    SELECT user_id from user WHERE username='${username}';`;
  const getUserId = await database.get(getUserIdQuery);
  request.user_id = getUserId.user_id;
  next();
};

// Write a middleware to authenticate the JWT token.
const authenticateToken = (request, response, next) => {
  const { username } = request;
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    // If the JWT token is not provided by the user or an invalid JWT token is provided
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "my_secret_token", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        //passing user details to handler function
        request.username = payload.username;
        next();
      }
    });
  }
};

// API 1 USER REGISTER
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);

  if (password.length < 6) {
    response.status(400);
    response.send("Password is too short");
  } else if (dbUser === undefined) {
    const registerUserQuery = `
        INSERT INTO user(username, password, name, gender)
        VALUES(
            '${username}',
            '${hashedPassword}',
            '${name}',
            '${gender}'
        );`;
    const dbResponse = await database.run(registerUserQuery);
    response.send("User created successfully");
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// API 2 USER LOGIN
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);

  if (dbUser === undefined) {
    // If the user doesn't have a Twitter account
    response.status(400);
    response.send("Invalid user");
  } else {
    //
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched) {
      // Successful login of the user
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "my_secret_token");
      response.send({ jwtToken });
    } else {
      //If the user provides an incorrect password
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// API 3 Returns the latest tweets of people whom the user follows. Return 4 tweets at a time
app.get(
  "/user/tweets/feed/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { user_name, user_id } = request;
    const getTweetsQuery = `
    SELECT
    user.username,
    tweet.tweet ,
    tweet.date_time AS dateTime
    FROM (follower
    INNER JOIN tweet ON follower.following_user_id = tweet.user_id) AS T
    INNER JOIN user ON T.following_user_id = user.user_id
    WHERE follower.follower_user_id = ${user_id}
    ORDER BY date_time DESC
    LIMIT 4;
    `;

    const tweetFeedArray = await database.all(getTweetsQuery);
    response.send(tweetFeedArray);
    console.log(tweetFeedArray);
  }
);
//  API 4 Returns the list of all names of people whom the user follows
app.get(
  "/user/following/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { user_name, user_id } = request;
    const getFollowingUsers = `
    select user.name from user INNER JOIN follower ON user.user_id = follower.following_user_id
    where follower.follower_user_id = ${user_id};
    `;
    const userFollowsList = await database.all(getFollowingUsers);
    response.send(userFollowsList);
  }
);

// API 5 Returns the list of all names of people who follows the user

app.get(
  "/user/followers/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { user_name, user_id } = request;
    //   console.log(getUserId);
    const getFollowersQuery = `
  SELECT
  user.name 
  FROM 
  user INNER JOIN follower ON user.user_id = follower.follower_user_id 
  WHERE follower.following_user_id = ${user_id}
  ;`;
    const getFollowersArray = await database.all(getFollowersQuery);
    response.send(getFollowersArray);
  }
);

// API 6 If the user requests a tweet other than the users he is following

app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { tweetId } = request.params;
    const { user_id } = request;
    const tweetsQuery = `SELECT * FROM tweet WHERE tweet_id=${tweetId}
    ;`;
    const tweetsResult = await database.get(tweetsQuery);
    console.log(tweetsResult);
    const userFollowersQuery = `
    SELECT * FROM follower
    INNER JOIN user ON user.user_id= follower.following_user_id
    WHERE follower.follower_user_id =${user_id};
    `;
    const userFollowers = await database.all(userFollowersQuery);
    console.log(userFollowers);
    if (
      userFollowers.some(
        (item) => item.following_user_id === tweetsResult.user_id
      )
    ) {
      const getTweetDetailsQuery = `
            SELECT
                tweet,
                COUNT(DISTINCT(like.like_id)) AS likes,
                COUNT(DISTINCT(reply.reply_id)) AS replies,
                tweet.date_time AS dateTime
            FROM
                tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id
                INNER JOIN reply ON reply.tweet_id = tweet.tweet_id
            WHERE tweet.tweet_id =${tweetId}  AND tweet.user_id =${userFollowers[0].user_id};`;
      const tweetDetails = await database.get(getTweetDetailsQuery);
      response.send(tweetDetails);
      console.log(tweetDetails);
    } else {
      // If the user requests a tweet other than the users he is following
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//API 7 If the user requests a tweet of a user he is following, return the list of usernames who liked the tweet
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { user_id } = request;
    const { tweetId } = request.params;
    const getFollowingIdsQuery = `
    SELECT 
        *
    FROM 
        follower 
    INNER JOIN tweet ON tweet.user_id = follower.following_user_id
    INNER JOIN like ON like.tweet_id = tweet.tweet_id
    INNER JOIN user ON user.user_id = like.user_id    
    WHERE 
       tweet.tweet_id = ${tweetId} AND follower.follower_user_id = ${user_id}
    ;`;
    const likedUsers = await database.all(getFollowingIdsQuery);
    if (likedUsers.length !== 0) {
      let likes = likedUsers.map((eachUser) => {
        return eachUser.username;
      });
      response.send({ likes });
    } else {
      //If the user requests a tweet other than the users he is following
      response.status(401);
      response.send("Invalid Request");
    }
  }
);
// API 8 If the user requests a tweet of a user he is following, return the list of replies.
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { tweetId } = request.params;
    const { user_id } = request;
    const getRepliedUsersQuery = `
    SELECT * FROM follower
    INNER JOIN tweet ON  tweet.user_id = follower.following_user_id 
    INNER JOIN reply ON reply.tweet_id = tweet.tweet_id
    INNER JOIN user ON user.user_id = reply.user_id
    WHERE 
    tweet.tweet_id = ${tweetId} AND follower.follower_user_id = ${user_id}
    ;`;
    const repliedUsers = await database.all(getRepliedUsersQuery);
    console.log(repliedUsers);
    if (repliedUsers.length !== 0) {
      let replies = repliedUsers.map((eachUser) => {
        return {
          name: eachUser.name,
          reply: eachUser.reply,
        };
      });
      response.send({ replies });
    } else {
      //If the user requests a tweet other than the users he is following
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//API 9 Returns a list of all tweets of the user
app.get(
  "/user/tweets/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { user_id } = request;
    const getUserTweetsQuery = `
    SELECT 
    tweet.tweet AS tweet,
    COUNT(DISTINCT(like.like_id)) AS likes,
    COUNT(DISTINCT(reply.reply_id)) AS replies,
    tweet.date_time AS dateTime
    FROM (user 
    INNER JOIN tweet ON user.user_id = tweet.user_id) AS T
    INNER JOIN like ON like.tweet_id = T.tweet_id
    INNER JOIN reply ON reply.tweet_id = tweet.tweet_id
    WHERE user.user_id = ${user_id}
    GROUP BY tweet.tweet_id
    ;`;
    const userTweetsData = await database.all(getUserTweetsQuery);
    console.log(userTweetsData);
    response.send(userTweetsData);
  }
);

//API 10 Create a tweet in the tweet table
app.post(
  "/user/tweets/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { user_id } = request;
    const { tweet } = request.body;
    // const dateTime = new Date();

    const postTweetQuery = `
        INSERT INTO tweet(tweet, user_id)
        VALUES(
            '${tweet}',
            ${user_id}
            ) ;`;
    const updateUserTweet = await database.run(postTweetQuery);
    response.send("Created a Tweet");
  }
);

// API 11 If the user deletes his tweet
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  getUserId,
  async (request, response) => {
    const { user_id } = request;
    const { tweetId } = request.params;
    console.log(tweetId);
    const selectUserQuery = ` 
    SELECT * FROM tweet 
    WHERE tweet.user_id = ${user_id} AND tweet.tweet_id =${tweetId}; 
    `;
    const tweetUser = await database.all(selectUserQuery);
    console.log(tweetUser);
    if (tweetUser.length !== 0) {
      const deleteTweetQuery = `
            DELETE FROM tweet
            WHERE tweet.user_id = ${user_id} AND tweet.tweet_id = ${tweetId}
            ;`;
      await database.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      //If the user requests to delete a tweet of other users
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

// Exporting App Instance
module.exports = app;
