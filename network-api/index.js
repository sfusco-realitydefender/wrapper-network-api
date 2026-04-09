const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const util = require("util");
const app = express();
const PORT = process.env.PORT || 3000;

const TEST_IMAGES_DIR = path.join(__dirname, "test_images");
const TEST_AUDIO_DIR = path.join(__dirname, "test_audio");
const TEST_VIDEO_DIR = path.join(__dirname, "test_video");
const OUTPUT_DIR = path.join(__dirname, "output");
const HEATMAPS_SOURCE_DIRS = [
  path.join(OUTPUT_DIR, "rd-vision-input/rd-vision-preprocessing/heatmaps"),
  path.join(OUTPUT_DIR, "pipelines"),
];
const HEATMAPS_PUBLIC_DIR = path.join(OUTPUT_DIR, "heatmaps");

const upload = multer({ dest: "uploads/" });

app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "public")));
app.get("/api/heatmaps/:requestId/:fileName", async (req, res) => {
  const requestId = path.basename(req.params.requestId || "");
  const fileName = path.basename(req.params.fileName || "");
  if (!requestId || !fileName) {
    return res.status(400).json({ error: "Invalid heatmap path" });
  }

  const requestScopedPath = path.join(HEATMAPS_PUBLIC_DIR, requestId, fileName);
  const candidatePaths = [
    requestScopedPath,
    ...HEATMAPS_SOURCE_DIRS.map((dir) => path.join(dir, fileName)),
  ];

  for (const candidatePath of candidatePaths) {
    try {
      await fs.access(candidatePath);
      return res.sendFile(candidatePath);
    } catch {}
  }

  return res.status(404).json({ error: "Heatmap not found" });
});

// API status endpoint
app.get("/api/status", (req, res) => {
  res.json({ message: "Network API is running" });
});

// Health check endpoints for models
app.get("/api/health/image", async (req, res) => {
  try {
    const response = await axios.get("http://image-api:8000/health", {
      timeout: 2000,
    });
    res.json({
      status: "ready",
      message: "Image model is ready",
      details: response.data,
    });
  } catch (error) {
    res.json({
      status: "loading",
      message: "Image model is loading...",
      error: error.message,
    });
  }
});

// Track audio processing state
let audioProcessingCount = 0;

// Track video processing state
let videoProcessingCount = 0;

app.get("/api/health/audio", async (req, res) => {
  // If we're currently processing audio, return busy status
  if (audioProcessingCount > 0) {
    res.json({
      status: "busy",
      message: `Audio model is processing (${audioProcessingCount} file${audioProcessingCount > 1 ? "s" : ""})`,
      processing: true,
      count: audioProcessingCount,
    });
    return;
  }

  try {
    const response = await axios.get("http://audio-api:5000/health", {
      timeout: 3000, // Increased timeout slightly
    });
    res.json({
      status: "ready",
      message: "Audio model is ready",
      details: response.data,
    });
  } catch (error) {
    // Check if it's a timeout - might mean the server is busy
    if (error.code === "ECONNABORTED" || error.message.includes("timeout")) {
      res.json({
        status: "busy",
        message: "Audio model may be processing",
        error: error.message,
      });
    } else {
      res.json({
        status: "loading",
        message: "Audio model is loading...",
        error: error.message,
      });
    }
  }
});

app.get("/api/health/video", async (req, res) => {
  // If we're currently processing video, return busy status
  if (videoProcessingCount > 0) {
    res.json({
      status: "busy",
      message: `Video model is processing (${videoProcessingCount} file${videoProcessingCount > 1 ? "s" : ""})`,
      processing: true,
      count: videoProcessingCount,
    });
    return;
  }

  try {
    const response = await axios.get("http://video-api:5000/health", {
      timeout: 3000,
    });
    res.json({
      status: "ready",
      message: "Video model is ready",
      details: response.data,
    });
  } catch (error) {
    // Check if it's a timeout - might mean the server is busy
    if (error.code === "ECONNABORTED" || error.message.includes("timeout")) {
      res.json({
        status: "busy",
        message: "Video model may be processing",
        error: error.message,
      });
    } else {
      res.json({
        status: "loading",
        message: "Video model is loading...",
        error: error.message,
      });
    }
  }
});

async function waitForFile(filePath, timeoutMs = 60000, intervalMs = 500) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      await fs.access(filePath);
      return true;
    } catch (err) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(`Timeout waiting for file: ${filePath}`);
}

async function resolveHeatmapSourcePath(originalPath) {
  if (typeof originalPath !== "string" || !originalPath) return null;

  const fileName = path.basename(originalPath);
  const candidates = [
    ...HEATMAPS_SOURCE_DIRS.map((dir) => path.join(dir, fileName)),
    originalPath,
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }

  return null;
}

async function rewriteHeatmapPathsForRequest(imageResult, requestId) {
  if (!imageResult?.metadata || !requestId) return;

  const requestHeatmapDir = path.join(HEATMAPS_PUBLIC_DIR, requestId);
  await fs.mkdir(requestHeatmapDir, { recursive: true });

  const rewrittenBySourcePath = new Map();

  async function rewriteHeatmapMap(heatmaps) {
    if (!heatmaps || typeof heatmaps !== "object") return;

    for (const [modelName, sourcePath] of Object.entries(heatmaps)) {
      if (typeof sourcePath !== "string" || !sourcePath) continue;
      const fileName = path.basename(sourcePath);
      const publicPath = `/api/heatmaps/${requestId}/${fileName}`;

      if (rewrittenBySourcePath.has(sourcePath)) {
        heatmaps[modelName] = rewrittenBySourcePath.get(sourcePath);
        continue;
      }

      const source = await resolveHeatmapSourcePath(sourcePath);
      if (source) {
        const destination = path.join(requestHeatmapDir, fileName);
        await fs.copyFile(source, destination);
      }

      rewrittenBySourcePath.set(sourcePath, publicPath);
      heatmaps[modelName] = publicPath;
    }
  }

  const bboxes = Array.isArray(imageResult.metadata.bboxes)
    ? imageResult.metadata.bboxes
    : [];
  for (const bboxData of bboxes) {
    await rewriteHeatmapMap(bboxData?.heatmaps);
  }

  await rewriteHeatmapMap(imageResult.metadata?.full_frame?.heatmaps);
}

app.post("/analyze", upload.single("image"), async (req, res) => {
  let inputFilePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided" });
    }

    await fs.mkdir(TEST_IMAGES_DIR, { recursive: true });

    const fileExtension = path.extname(req.file.originalname) || ".jpg";
    const imageId = uuidv4();
    const fileName = `${imageId}${fileExtension}`;
    inputFilePath = path.join(TEST_IMAGES_DIR, fileName);

    await fs.copyFile(req.file.path, inputFilePath);
    await fs.unlink(req.file.path);

    const visionApiResponse = await axios.post(
      "http://image-api:8000/predict",
      {
        images: [{ path: `/app/test_images/${fileName}` }],
        request_id: imageId,
      },
      {
        timeout: 120000, // 120 seconds timeout for image processing
        httpAgent: new (require("http").Agent)({ keepAlive: false }),
      },
    );

    if (
      !visionApiResponse.data.success ||
      !visionApiResponse.data.results?.[0]
    ) {
      throw new Error("Invalid response from image-api");
    }

    try {
      await rewriteHeatmapPathsForRequest(
        visionApiResponse.data.results[0],
        imageId,
      );
    } catch (err) {
      console.warn("Failed to rewrite heatmap paths for request", imageId, err);
    }

    await fs.unlink(inputFilePath);

    res.json(visionApiResponse.data);
  } catch (error) {
    if (inputFilePath) {
      try {
        await fs.unlink(inputFilePath);
      } catch {}
    }

    console.error("Error processing image:", error);
    res.status(500).json({
      error: "Failed to process image",
      message: error.message,
    });
  }
});

app.post("/analyze-audio", upload.single("audio"), async (req, res) => {
  let inputFilePath = null;
  let inputJsonPath = null;

  // Increment processing counter
  audioProcessingCount++;

  try {
    if (!req.file) {
      audioProcessingCount--;
      return res.status(400).json({ error: "No audio file provided" });
    }

    await fs.mkdir(TEST_AUDIO_DIR, { recursive: true });
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    const fileExtension = path.extname(req.file.originalname) || ".wav";
    const audioId = uuidv4();
    const fileName = `${audioId}${fileExtension}`;
    inputFilePath = path.join(TEST_AUDIO_DIR, fileName);

    await fs.copyFile(req.file.path, inputFilePath);
    await fs.unlink(req.file.path);

    const input_json = {
      files: [{ path: `/requests/${fileName}` }],
    };
    const inputId = uuidv4();
    inputJsonPath = path.join(TEST_AUDIO_DIR, `${inputId}.json`);
    await fs.writeFile(inputJsonPath, JSON.stringify(input_json), "utf-8");

    const audioApiResponse = await axios.post(
      "http://audio-api:5000/predict_from_json",
      {
        input_json_path: `/requests/${inputId}.json`,
        output_dir: "/results",
      },
      {
        timeout: 120000, // 120 seconds timeout for audio processing
      },
    );

    console.log(util.inspect(audioApiResponse.data, { depth: null }));

    if (
      audioApiResponse.data.status !== "completed" ||
      !audioApiResponse.data.results?.[0]
    ) {
      throw new Error("Invalid response from audio-api");
    }

    const parsedResult = audioApiResponse.data.results[0];

    await fs.unlink(inputFilePath);
    await fs.unlink(inputJsonPath);

    // Decrement processing counter on success
    audioProcessingCount--;

    res.json(parsedResult);
  } catch (error) {
    // Decrement processing counter on error
    audioProcessingCount--;

    if (inputFilePath) {
      try {
        await fs.unlink(inputFilePath);
      } catch {}
    }
    if (inputJsonPath) {
      try {
        await fs.unlink(inputJsonPath);
      } catch {}
    }

    console.error("Error processing audio:", error);

    // Check if it's a timeout error
    if (
      error.code === "ECONNABORTED" ||
      error.code === "ECONNRESET" ||
      error.message.includes("timeout")
    ) {
      res.status(504).json({
        error: "Audio processing timeout",
        message:
          "The audio file is taking longer than expected to process. Please try a shorter file or try again later.",
      });
    } else {
      res.status(500).json({
        error: "Failed to process audio",
        message: error.message,
      });
    }
  }
});

app.post("/analyze-video", upload.single("video"), async (req, res) => {
  let inputFilePath = null;
  let inputJsonPath = null;

  // Increment processing counter
  videoProcessingCount++;

  try {
    if (!req.file) {
      videoProcessingCount--;
      return res.status(400).json({ error: "No video file provided" });
    }

    await fs.mkdir(TEST_VIDEO_DIR, { recursive: true });
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    const fileExtension = path.extname(req.file.originalname) || ".mp4";
    const videoId = uuidv4();
    const fileName = `${videoId}${fileExtension}`;
    inputFilePath = path.join(TEST_VIDEO_DIR, fileName);

    await fs.copyFile(req.file.path, inputFilePath);
    await fs.unlink(req.file.path);

    const input_json = {
      files: [{ path: `/requests/${fileName}` }],
    };
    const inputId = uuidv4();
    inputJsonPath = path.join(TEST_VIDEO_DIR, `${inputId}.json`);
    await fs.writeFile(inputJsonPath, JSON.stringify(input_json), "utf-8");

    const videoApiResponse = await axios.post(
      "http://video-api:5000/predict_from_path",
      {
        directory: "/app/requests",
        extensions: ["mp4", "mov", "avi", "webm"],
        recursive: true,
        output_dir: "/app/results",
      },
      {
        timeout: 600000, // 600 seconds (10 minutes) timeout for video processing
      },
    );

    console.log(util.inspect(videoApiResponse.data, { depth: null }));

    if (
      videoApiResponse.data.status !== "completed" ||
      !videoApiResponse.data.results
    ) {
      throw new Error("Invalid response from video-api");
    }

    // Find the result for our specific uploaded file
    const targetPath = `/app/requests/${fileName}`;
    const parsedResult = videoApiResponse.data.results.find(
      (r) => r.file_path === targetPath,
    );

    if (!parsedResult) {
      throw new Error(`No result found for file: ${fileName}`);
    }

    // Clean up all processed video files to prevent reprocessing
    for (const result of videoApiResponse.data.results) {
      if (result.file_path && result.status === "success") {
        const cleanupPath = result.file_path.replace("/app/requests/", "");
        const fullCleanupPath = path.join(TEST_VIDEO_DIR, cleanupPath);
        try {
          await fs.unlink(fullCleanupPath);
        } catch (err) {
          console.warn(
            `Failed to delete processed video file: ${fullCleanupPath}`,
            err.message,
          );
        }
      }
    }

    if (inputJsonPath) {
      try {
        await fs.unlink(inputJsonPath);
      } catch (err) {
        console.warn(
          `Failed to delete input JSON: ${inputJsonPath}`,
          err.message,
        );
      }
    }

    // Decrement processing counter on success
    videoProcessingCount--;

    res.json(parsedResult);
  } catch (error) {
    // Decrement processing counter on error
    videoProcessingCount--;

    if (inputFilePath) {
      try {
        await fs.unlink(inputFilePath);
      } catch {}
    }
    if (inputJsonPath) {
      try {
        await fs.unlink(inputJsonPath);
      } catch {}
    }

    console.error("Error processing video:", error);

    // Check if it's a timeout error
    if (
      error.code === "ECONNABORTED" ||
      error.code === "ECONNRESET" ||
      error.message.includes("timeout")
    ) {
      res.status(504).json({
        error: "Video processing timeout",
        message:
          "The video file is taking longer than expected to process. Please try a shorter file or try again later.",
      });
    } else {
      res.status(500).json({
        error: "Failed to process video",
        message: error.message,
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
