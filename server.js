const express = require("express");
const axios = require("axios");
const { Pool } = require("pg");
const cron = require("node-cron");
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("."));

// Postgres connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Function to fetch and store "on the fly" clips with pagination
const fetchAndStoreClips = async () => {
  try {
    const tokenResponse = await axios.post("https://zoom.us/oauth/token", null, {
      params: { grant_type: "client_credentials" },
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString("base64")}`,
      },
    });
    const accessToken = tokenResponse.data.access_token;

    let allClips = [];
    let nextPageToken = "";
    const pageSize = 50; // Increase page size to reduce API calls

    do {
      const clipsResponse = await axios.get("https://api.zoom.us/v2/users/me/clips", {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          user_id: "me",
          page_size: pageSize,
          next_page_token: nextPageToken || undefined,
        },
      });

      const clips = clipsResponse.data.clips || [];
      allClips = allClips.concat(clips);
      nextPageToken = clipsResponse.data.next_page_token || "";
    } while (nextPageToken);

    // Filter for "on the fly" clips (no recording_meeting_id)
    const onTheFlyClips = allClips.filter(clip => !clip.recording_meeting_id);

    let storedCount = 0;
    for (const clip of onTheFlyClips) {
      await pool.query(
        `INSERT INTO clips (clip_id, title, download_url, recording_meeting_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (clip_id) DO NOTHING`,
        [clip.id, clip.title, clip.download_url, clip.recording_meeting_id || null]
      );
      storedCount++;
    }

    console.log(`Stored ${storedCount} "on the fly" clips`);
    return storedCount;
  } catch (error) {
    console.error("Error fetching clips:", error.message);
    return 0;
  }
};

// Schedule polling every 5 minutes
cron.schedule("*/5 * * * *", () => {
  fetchAndStoreClips();
  console.log("Polling for new clips...");
});

// Endpoint to get clips and their status
app.get("/clips", async (req, res) => {
  try {
    const clipsResult = await pool.query("SELECT * FROM clips ORDER BY created_at DESC");
    const clips = clipsResult.rows;

    for (const clip of clips) {
      const statusResult = await pool.query("SELECT is_processed FROM clip_statuses WHERE clip_id = $1", [clip.clip_id]);
      clip.is_processed = statusResult.rows.length > 0 ? statusResult.rows[0].is_processed : false;
    }

    res.json(clips);
  } catch (error) {
    console.error("Failed to fetch clips:", error.message);
    res.status(500).send("Failed to fetch clips");
  }
});

// Salesforce OAuth (simplified, placeholder for later integration)
app.get("/salesforce-auth", (req, res) => {
  const sfAuthUrl = `https://login.salesforce.com/services/oauth2/authorize?response_type=code&client_id=${process.env.SALESFORCE_CLIENT_ID}&redirect_uri=https://${req.headers.host}/salesforce-callback&scope=api%20refresh_token`;
  res.redirect(sfAuthUrl);
});

app.get("/salesforce-callback", async (req, res) => {
  const code = req.query.code;
  try {
    const response = await axios.post("https://login.salesforce.com/services/oauth2/token", null, {
      params: {
        grant_type: "authorization_code",
        code,
        client_id: process.env.SALESFORCE_CLIENT_ID,
        client_secret: process.env.SALESFORCE_CLIENT_SECRET,
        redirect_uri: `https://${req.headers.host}/salesforce-callback`,
      },
    });
    const accessToken = response.data.access_token;
    // TODO: Store token in Postgres
    res.redirect("/");
  } catch (error) {
    res.send("Salesforce OAuth failed: " + error.message);
  }
});

// Process clips (mock processing for now)
app.post("/process-clips", async (req, res) => {
  const { clipIds } = req.body;
  try {
    for (const clipId of clipIds) {
      await pool.query(
        `INSERT INTO clip_statuses (clip_id, is_processed, knowledge_article_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (clip_id) DO UPDATE SET is_processed = $2, knowledge_article_id = $3`,
        [clipId, true, "mock-article-id"]
      );
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to process clips:", error.message);
    res.status(500).send("Failed to process clips");
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
