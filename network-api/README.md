# Network API with Upload Interface

A unified service that provides both API endpoints for image/audio processing and a web interface for file uploads.

## Features

### Web Interface (accessible at http://localhost:3000)
- **Drag & Drop Upload**: Easy file upload with drag-and-drop or click to select
- **Multiple File Support**: Upload multiple files at once
- **File Type Support**: 
  - Images: JPG, PNG, GIF, WEBP
  - Audio: MP3, WAV, M4A
- **Real-time Status**: See upload and processing status in real-time
- **Result Inspection**: View analysis results in a modal with JSON formatting

### API Endpoints
- `POST /analyze` - Analyze image files
- `POST /analyze-audio` - Analyze audio files
- `GET /api/status` - Check API status

## Running Locally

### Prerequisites
- Node.js 18+
- Docker (for running with vision-api and audio-api)

### Standalone Mode (without Docker)

```bash
# Install dependencies
npm install

# Start the server
npm start
```

The application will be available at http://localhost:3000

### With Docker

```bash
# From the root directory
docker-compose up network-api
```

Note: This requires the vision-api and audio-api services to be available.

## File Structure

```
network-api/
├── index.js          # Express server with API endpoints
├── public/           # Web interface files
│   ├── index.html   # Main HTML page
│   ├── styles.css   # CSS styles
│   └── app.js       # JavaScript application
├── test_images/     # Temporary image storage
├── test_audio/      # Temporary audio storage
├── output/          # Processing output
└── Dockerfile       # Docker configuration
```

## Usage

### Web Interface
1. Navigate to http://localhost:3000
2. Drag and drop files or click to select
3. View upload progress in the table
4. Click "Inspect" to see analysis results

### API Direct Usage

#### Image Analysis
```bash
curl -X POST -F "image=@/path/to/image.jpg" http://localhost:3000/analyze
```

#### Audio Analysis
```bash
curl -X POST -F "audio=@/path/to/audio.mp3" http://localhost:3000/analyze-audio
```

## Architecture

The service integrates:
- **Frontend**: Vanilla JavaScript with modern CSS for the upload interface
- **Backend**: Express.js server handling both static files and API endpoints
- **Processing**: Forwards requests to vision-api and audio-api services
