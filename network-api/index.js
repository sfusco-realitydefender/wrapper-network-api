const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const app = express();
const PORT = process.env.PORT || 3000;

const TEST_IMAGES_DIR = path.join(__dirname, 'test_images');
const TEST_AUDIO_DIR = path.join(__dirname, 'test_audio');
const OUTPUT_DIR = path.join(__dirname, 'output');

const upload = multer({ dest: 'uploads/' });

app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// API status endpoint
app.get('/api/status', (req, res) => {
  res.json({ message: 'Network API is running' });
});

// Health check endpoints for models
app.get('/api/health/image', async (req, res) => {
  try {
    const response = await axios.get('http://vision-api:8000/health', { 
      timeout: 2000 
    });
    res.json({ 
      status: 'ready', 
      message: 'Image model is ready',
      details: response.data 
    });
  } catch (error) {
    res.json({ 
      status: 'loading', 
      message: 'Image model is loading...',
      error: error.message 
    });
  }
});

// Track audio processing state
let audioProcessingCount = 0;

app.get('/api/health/audio', async (req, res) => {
  // If we're currently processing audio, return busy status
  if (audioProcessingCount > 0) {
    res.json({ 
      status: 'busy', 
      message: `Audio model is processing (${audioProcessingCount} file${audioProcessingCount > 1 ? 's' : ''})`,
      processing: true,
      count: audioProcessingCount
    });
    return;
  }
  
  try {
    const response = await axios.get('http://audio-api:5000/health', { 
      timeout: 3000  // Increased timeout slightly
    });
    res.json({ 
      status: 'ready', 
      message: 'Audio model is ready',
      details: response.data 
    });
  } catch (error) {
    // Check if it's a timeout - might mean the server is busy
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      res.json({ 
        status: 'busy', 
        message: 'Audio model may be processing',
        error: error.message 
      }); can 
    } else {
      res.json({ 
        status: 'loading', 
        message: 'Audio model is loading...',
        error: error.message 
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
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(`Timeout waiting for file: ${filePath}`);
}

app.post('/analyze', upload.single('image'), async (req, res) => {
  let inputFilePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    await fs.mkdir(TEST_IMAGES_DIR, { recursive: true });

    const fileExtension = path.extname(req.file.originalname) || '.jpg';
    const imageId = uuidv4();
    const fileName = `${imageId}${fileExtension}`;
    inputFilePath = path.join(TEST_IMAGES_DIR, fileName);

    await fs.copyFile(req.file.path, inputFilePath);
    await fs.unlink(req.file.path);

    const visionApiResponse = await axios.post('http://vision-api:8000/predict', {
      images: [
        { path: `/app/test_images/${fileName}` }
      ],
      request_id: imageId
    }, {
      timeout: 120000,  // 120 seconds timeout for image processing
      httpAgent: new (require('http').Agent)({ keepAlive: false })
    });


    if (!visionApiResponse.data.success || !visionApiResponse.data.results?.[0]) {
      throw new Error('Invalid response from vision-api');
    }

    const result = visionApiResponse.data.results[0];
    
    // Clean up input file
    await fs.unlink(inputFilePath);

    // Return the full result (includes metadata, bboxes, scores, heatmaps, etc.)
    res.json(result);

  } catch (error) {
    if (inputFilePath) {
      try {
        await fs.unlink(inputFilePath);
      } catch {}
    }

    console.error('Error processing image:', error);
    res.status(500).json({
      error: 'Failed to process image',
      message: error.message
    });
  }
});

app.post('/analyze-audio', upload.single('audio'), async (req, res) => {
  let inputFilePath = null;
  let inputJsonPath = null;
  
  // Increment processing counter
  audioProcessingCount++;

  try {
    if (!req.file) {
      audioProcessingCount--;
      return res.status(400).json({ error: 'No audio file provided' });
    }

    await fs.mkdir(TEST_AUDIO_DIR, { recursive: true });
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    const fileExtension = path.extname(req.file.originalname) || '.wav';
    const audioId = uuidv4();
    const fileName = `${audioId}${fileExtension}`;
    inputFilePath = path.join(TEST_AUDIO_DIR, fileName);

    await fs.copyFile(req.file.path, inputFilePath);
    await fs.unlink(req.file.path);

    const input_json = {
      "files": [
        {"path": `/requests/${fileName}`},
      ]
    }
    const inputId = uuidv4();
    inputJsonPath = path.join(TEST_AUDIO_DIR, `${inputId}.json`);
    await fs.writeFile(inputJsonPath, JSON.stringify(input_json), 'utf-8');

    const audioApiResponse = await axios.post('http://audio-api:5000/predict_from_json', {
      "input_json_path": `/requests/${inputId}.json`,
      "output_dir": "/results"
    }, {
      timeout: 120000  // 120 seconds timeout for audio processing
    });

    console.log(util.inspect(audioApiResponse.data, { depth: null }));

    if (audioApiResponse.data.status !== 'completed' || !audioApiResponse.data.results?.[0]) {
      throw new Error('Invalid response from audio-api');
    }

    const parsedResult = audioApiResponse.data.results[0]

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

    console.error('Error processing audio:', error);
    
    // Check if it's a timeout error
    if (error.code === 'ECONNABORTED' || error.code === 'ECONNRESET' || error.message.includes('timeout')) {
      res.status(504).json({
        error: 'Audio processing timeout',
        message: 'The audio file is taking longer than expected to process. Please try a shorter file or try again later.'
      });
    } else {
      res.status(500).json({
        error: 'Failed to process audio',
        message: error.message
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
