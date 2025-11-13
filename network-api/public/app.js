// State management
const uploadState = {
  files: new Map(),
  currentResult: null,
  currentAudio: null,
  currentImageModal: null,
  modelStatus: {
    image: 'checking',
    audio: 'checking'
  }
};

// DOM elements
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const uploadTable = document.getElementById('uploadTable');
const uploadTableBody = document.getElementById('uploadTableBody');
const resultModal = document.getElementById('resultModal');
const resultContent = document.getElementById('resultContent');

// Initialize event listeners
function initializeApp() {
  // Verify elements exist
  if (!dropzone || !fileInput) {
    console.error('Required elements not found:', { dropzone: !!dropzone, fileInput: !!fileInput });
    return;
  }
  
  // Dropzone click handler - trigger file input
  dropzone.addEventListener('click', function(e) {
    e.preventDefault();
    // Programmatically click the file input
    fileInput.click();
    console.log('Dropzone clicked, triggering file input');
  });
  
  // Drag and drop events
  dropzone.addEventListener('dragover', handleDragOver);
  dropzone.addEventListener('dragleave', handleDragLeave);
  dropzone.addEventListener('drop', handleDrop);
  
  // File input change
  fileInput.addEventListener('change', handleFileSelect);
  
  // Prevent default drag behavior on document
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
  
  // Start health checks
  checkModelHealth();
  setInterval(checkModelHealth, 10000); // Check every 10 seconds
}

// Drag and drop handlers
function handleDragOver(e) {
  e.preventDefault();
  dropzone.classList.add('dragover');
}

function handleDragLeave(e) {
  e.preventDefault();
  if (e.target === dropzone) {
    dropzone.classList.remove('dragover');
  }
}

function handleDrop(e) {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  
  const files = Array.from(e.dataTransfer.files);
  processFiles(files);
}

function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  processFiles(files);
  // Reset input
  fileInput.value = '';
}

// File processing
function processFiles(files) {
  files.forEach(file => {
    if (isValidFile(file)) {
      const fileId = generateId();
      const fileData = {
        id: fileId,
        file: file,
        name: file.name,
        size: formatFileSize(file.size),
        type: getFileType(file),
        status: 'uploading',
        result: null,
        error: null,
        decision: null,
        score: null,
        uploadedAt: new Date().toISOString()
      };
      
      uploadState.files.set(fileId, fileData);
      addTableRow(fileData);
      uploadFile(fileData);
    } else {
      alert(`Invalid file type: ${file.name}. Please upload image or audio files only.`);
    }
  });
}

function isValidFile(file) {
  const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const audioTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/x-m4a', 'audio/mp4'];
  
  return imageTypes.includes(file.type) || audioTypes.includes(file.type) || 
         (file.type === '' && (file.name.endsWith('.mp3') || file.name.endsWith('.wav') || file.name.endsWith('.m4a')));
}

function getFileType(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/') || file.name.match(/\.(mp3|wav|m4a)$/i)) return 'audio';
  return 'unknown';
}

// File upload
async function uploadFile(fileData) {
  const formData = new FormData();
  
  // Use different field names for image vs audio as expected by the backend
  const fieldName = fileData.type === 'image' ? 'image' : 'audio';
  formData.append(fieldName, fileData.file);
  
  const endpoint = fileData.type === 'image' ? '/analyze' : '/analyze-audio';
  
  try {
    // Update status to processing
    updateFileStatus(fileData.id, 'processing');
    
    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Upload failed');
    }
    
    const result = await response.json();
    
    // Extract decision and score based on file type
    if (fileData.type === 'image') {
      fileData.decision = result['rd-img-ensemble']?.decision || 'UNKNOWN';
      fileData.score = result['rd-img-ensemble']?.score || 0;
    } else if (fileData.type === 'audio') {
      // Check for different possible field names in audio response
      fileData.decision = result.final_decision || result.decision || result.prediction || 'UNKNOWN';
      fileData.score = result.final_probability || result.probability || result.score || 0;
      
      // Log the result structure for debugging
      console.log('Audio result structure:', result);
    }
    
    // Update file data
    fileData.result = result;
    fileData.status = 'completed';
    fileData.error = null; // Clear any previous errors
    
    // Make sure we have valid decision and score before updating
    if (fileData.decision === 'UNKNOWN' && fileData.type === 'audio') {
      console.warn('Audio processing completed but decision/score fields not found in response');
    }
    
    updateFileStatus(fileData.id, 'completed', result);
    
  } catch (error) {
    console.error('Upload error:', error);
    
    // Check if it's a timeout error
    let errorMessage = error.message || 'Upload failed';
    if (error.response?.status === 504) {
      errorMessage = 'Processing timeout - the file may be too large or complex. Please try again.';
    }
    
    fileData.error = errorMessage;
    fileData.status = 'error';
    updateFileStatus(fileData.id, 'error', null, errorMessage);
  }
}

// Table management
function addTableRow(fileData) {
  // Show table and header
  uploadTable.classList.add('has-data');
  document.getElementById('tableHeader').style.display = 'flex';
  updateTableCount();
  
  const row = document.createElement('tr');
  row.id = `row-${fileData.id}`;
  row.innerHTML = `
    <td>
      <div class="preview-container" onclick="handlePreviewClick('${fileData.id}')">
        ${getPreviewHTML(fileData)}
      </div>
    </td>
    <td>${escapeHtml(fileData.name)}</td>
    <td><span class="file-type ${fileData.type}">${fileData.type}</span></td>
    <td>${fileData.size}</td>
    <td class="decision-cell">${getDecisionHTML(fileData.decision)}</td>
    <td class="score-cell">${getScoreHTML(fileData.score)}</td>
    <td class="status-cell">
      ${getStatusHTML(fileData.status)}
    </td>
    <td class="actions-cell">
      ${getActionsHTML(fileData)}
    </td>
  `;
  
  uploadTableBody.appendChild(row);
}

function updateFileStatus(fileId, status, result = null, error = null) {
  const fileData = uploadState.files.get(fileId);
  if (!fileData) return;
  
  fileData.status = status;
  if (result) fileData.result = result;
  if (error) fileData.error = error;
  
  const row = document.getElementById(`row-${fileId}`);
  if (!row) return;
  
  // Update decision cell
  const decisionCell = row.querySelector('.decision-cell');
  if (decisionCell) {
    decisionCell.innerHTML = getDecisionHTML(fileData.decision);
  }
  
  // Update score cell
  const scoreCell = row.querySelector('.score-cell');
  if (scoreCell) {
    scoreCell.innerHTML = getScoreHTML(fileData.score);
  }
  
  // Update status cell
  const statusCell = row.querySelector('.status-cell');
  statusCell.innerHTML = getStatusHTML(status, error);
  
  // Update actions cell
  const actionsCell = row.querySelector('.actions-cell');
  actionsCell.innerHTML = getActionsHTML(fileData);
  
  // Update table count
  updateTableCount();
}

function getPreviewHTML(fileData) {
  if (fileData.type === 'image' && fileData.file) {
    const url = URL.createObjectURL(fileData.file);
    // Clean up object URL after image loads
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return `<img src="${url}" alt="${fileData.name}" class="preview-image">`;
  } else if (fileData.type === 'audio') {
    return `
      <svg class="preview-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path>
      </svg>
    `;
  }
  return `
    <svg class="preview-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
    </svg>
  `;
}

function getStatusHTML(status, error = null) {
  switch (status) {
    case 'uploading':
      return `
        <div class="status uploading">
          <div class="spinner"></div>
          <span>Uploading...</span>
        </div>
      `;
    case 'processing':
      return `
        <div class="status processing">
          <div class="spinner"></div>
          <span>Processing...</span>
        </div>
      `;
    case 'completed':
      return `
        <div class="status completed">
          <svg class="status-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <span>Done</span>
        </div>
      `;
    case 'error':
      return `
        <div class="status error" title="${error || 'Upload failed'}">
          <svg class="status-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <span>Error</span>
        </div>
      `;
    default:
      return '<span>Unknown</span>';
  }
}

function getActionsHTML(fileData) {
  if (fileData.status === 'completed' && fileData.result) {
    return `
      <div class="actions-group">
        <button class="btn-icon btn-primary" onclick="showResult('${fileData.id}')" title="Inspect Result">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </button>
        <button class="btn-icon btn-secondary" onclick="downloadJSON('${fileData.id}')" title="Download JSON">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
          </svg>
        </button>
      </div>
    `;
  } else if (fileData.status === 'error') {
    return `
      <button class="btn-icon btn-secondary" onclick="retryUpload('${fileData.id}')" title="Retry Upload">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
    `;
  }
  return '';
}

// Helper functions for decision and score display
function getDecisionHTML(decision) {
  if (!decision) return '<span class="decision-pending">-</span>';
  
  const className = decision === 'ARTIFICIAL' ? 'decision-artificial' : 
                   decision === 'AUTHENTIC' ? 'decision-authentic' : 
                   'decision-unknown';
  
  return `<span class="decision ${className}">${decision}</span>`;
}

function getScoreHTML(score) {
  if (score === null || score === undefined) return '<span class="score-pending">-</span>';
  
  const percentage = (score * 100).toFixed(1);
  const className = score >= 0.7 ? 'score-high' : 
                   score >= 0.3 ? 'score-medium' : 
                   'score-low';
  
  return `<span class="score ${className}">${percentage}%</span>`;
}

// Result modal
function showResult(fileId) {
  const fileData = uploadState.files.get(fileId);
  if (!fileData || !fileData.result) return;
  
  uploadState.currentResult = fileData.result;
  resultContent.textContent = JSON.stringify(fileData.result, null, 2);
  resultModal.classList.add('show');
}

function closeResultModal() {
  resultModal.classList.remove('show');
  uploadState.currentResult = null;
}

function copyResult(event) {
  if (!uploadState.currentResult) return;
  
  const text = JSON.stringify(uploadState.currentResult, null, 2);
  const button = event ? event.target : document.querySelector('.modal-footer .btn-secondary');
  
  navigator.clipboard.writeText(text).then(() => {
    // Show temporary success message
    const originalText = button.textContent;
    button.textContent = 'Copied!';
    button.classList.add('btn-success');
    setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('btn-success');
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy:', err);
    // Fallback method for older browsers or when clipboard API fails
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      const originalText = button.textContent;
      button.textContent = 'Copied!';
      button.classList.add('btn-success');
      setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove('btn-success');
      }, 2000);
    } catch (err) {
      alert('Failed to copy to clipboard. Please try selecting and copying manually.');
    }
    document.body.removeChild(textArea);
  });
}

// Retry upload
function retryUpload(fileId) {
  const fileData = uploadState.files.get(fileId);
  if (!fileData) return;
  
  fileData.status = 'uploading';
  fileData.error = null;
  updateFileStatus(fileId, 'uploading');
  uploadFile(fileData);
}

// Media preview handlers
function handlePreviewClick(fileId) {
  const fileData = uploadState.files.get(fileId);
  if (!fileData) return;
  
  if (fileData.type === 'image') {
    showImagePreview(fileData);
  } else if (fileData.type === 'audio') {
    toggleAudioPlayback(fileData);
  }
}

function showImagePreview(fileData) {
  // Close any existing image modal
  if (uploadState.currentImageModal) {
    closeImageModal();
  }
  
  // Stop any playing audio
  if (uploadState.currentAudio) {
    stopCurrentAudio();
  }
  
  const imageModal = document.getElementById('imageModal');
  const modalImage = document.getElementById('modalImage');
  
  const url = URL.createObjectURL(fileData.file);
  modalImage.src = url;
  modalImage.alt = fileData.name;
  
  imageModal.classList.add('show');
  uploadState.currentImageModal = { fileData, url };
}

function closeImageModal() {
  const imageModal = document.getElementById('imageModal');
  imageModal.classList.remove('show');
  
  if (uploadState.currentImageModal && uploadState.currentImageModal.url) {
    URL.revokeObjectURL(uploadState.currentImageModal.url);
  }
  
  uploadState.currentImageModal = null;
}

// Make closeImageModal available globally for the modal close button
window.closeImageModal = closeImageModal;

function toggleAudioPlayback(fileData) {
  // If clicking on the same audio that's playing, pause it
  if (uploadState.currentAudio && uploadState.currentAudio.fileId === fileData.id) {
    if (uploadState.currentAudio.audio.paused) {
      uploadState.currentAudio.audio.play();
    } else {
      uploadState.currentAudio.audio.pause();
      uploadState.currentAudio.audio.currentTime = 0; // Reset to beginning
    }
    return;
  }
  
  // Stop any currently playing audio
  if (uploadState.currentAudio) {
    stopCurrentAudio();
  }
  
  // Close any open image modal
  if (uploadState.currentImageModal) {
    closeImageModal();
  }
  
  // Create new audio element
  const audio = new Audio();
  const url = URL.createObjectURL(fileData.file);
  audio.src = url;
  
  // Update preview container to show playing state
  const row = document.getElementById(`row-${fileData.id}`);
  const previewContainer = row.querySelector('.preview-container');
  previewContainer.classList.add('audio-playing');
  
  // Set up event listeners
  audio.addEventListener('ended', () => {
    stopCurrentAudio();
  });
  
  audio.addEventListener('pause', () => {
    if (uploadState.currentAudio && uploadState.currentAudio.fileId === fileData.id) {
      previewContainer.classList.remove('audio-playing');
    }
  });
  
  audio.addEventListener('play', () => {
    if (uploadState.currentAudio && uploadState.currentAudio.fileId === fileData.id) {
      previewContainer.classList.add('audio-playing');
    }
  });
  
  // Start playing
  audio.play();
  
  uploadState.currentAudio = {
    fileId: fileData.id,
    audio: audio,
    url: url
  };
}

function stopCurrentAudio() {
  if (!uploadState.currentAudio) return;
  
  const { fileId, audio, url } = uploadState.currentAudio;
  
  // Stop and cleanup audio
  audio.pause();
  audio.currentTime = 0;
  URL.revokeObjectURL(url);
  
  // Update UI
  const row = document.getElementById(`row-${fileId}`);
  if (row) {
    const previewContainer = row.querySelector('.preview-container');
    if (previewContainer) {
      previewContainer.classList.remove('audio-playing');
    }
  }
  
  uploadState.currentAudio = null;
}

// Model health check functions
async function checkModelHealth() {
  // Check image model
  checkImageModel();
  // Check audio model
  checkAudioModel();
}

async function checkImageModel() {
  try {
    const response = await fetch('/api/health/image');
    const data = await response.json();
    updateModelStatus('image', data.status, data.message);
  } catch (error) {
    updateModelStatus('image', 'error', 'Failed to check status');
  }
}

async function checkAudioModel() {
  try {
    const response = await fetch('/api/health/audio');
    const data = await response.json();
    updateModelStatus('audio', data.status, data.message);
  } catch (error) {
    updateModelStatus('audio', 'error', 'Failed to check status');
  }
}

function updateModelStatus(model, status, message) {
  uploadState.modelStatus[model] = status;
  
  const statusElement = document.getElementById(`${model}ModelStatus`);
  if (!statusElement) return;
  
  const statusIcon = statusElement.querySelector('.status-icon');
  const statusValue = statusElement.querySelector('.status-value');
  
  // Remove all status classes
  statusElement.classList.remove('status-ready', 'status-loading', 'status-error', 'status-busy');
  
  // Update based on status
  if (status === 'ready') {
    statusElement.classList.add('status-ready');
    statusIcon.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    `;
    statusValue.textContent = 'Ready';
  } else if (status === 'busy') {
    // Show as ready but with processing indicator
    statusElement.classList.add('status-ready');
    statusIcon.innerHTML = `
      <svg class="status-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
      </svg>
    `;
    statusValue.textContent = 'Processing';
  } else if (status === 'loading') {
    statusElement.classList.add('status-loading');
    statusIcon.innerHTML = `
      <svg class="status-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
      </svg>
    `;
    statusValue.textContent = 'Loading...';
  } else {
    statusElement.classList.add('status-error');
    statusIcon.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    `;
    statusValue.textContent = 'Offline';
  }
  
  // Add tooltip with message
  statusElement.title = message || '';
}

// Download JSON functionality
function downloadJSON(fileId) {
  const fileData = uploadState.files.get(fileId);
  if (!fileData || !fileData.result) return;
  
  // Create blob with formatted JSON
  const blob = new Blob([JSON.stringify(fileData.result, null, 2)], {
    type: 'application/json'
  });
  
  // Create download link
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  
  // Generate filename with original name and timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const baseName = fileData.name.replace(/\.[^/.]+$/, ''); // Remove extension
  a.download = `analysis-${baseName}-${timestamp}.json`;
  
  // Trigger download
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  // Clean up
  URL.revokeObjectURL(url);
}

// Utility functions
function generateId() {
  return `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Theme management
function initializeTheme() {
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');
  const themeLabel = themeToggle?.querySelector('.theme-label');
  
  // Check for saved theme preference or default to system preference
  const savedTheme = localStorage.getItem('theme');
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const currentTheme = savedTheme || systemTheme;
  
  // Apply initial theme
  document.documentElement.setAttribute('data-theme', currentTheme);
  updateThemeUI(currentTheme);
  
  // Theme toggle click handler
  themeToggle?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const newTheme = current === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeUI(newTheme);
  });
  
  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('theme')) {
      const newTheme = e.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', newTheme);
      updateThemeUI(newTheme);
    }
  });
  
  function updateThemeUI(theme) {
    if (!themeIcon || !themeLabel) return;
    
    if (theme === 'dark') {
      // Show moon icon for dark mode
      themeIcon.innerHTML = `
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      `;
      themeLabel.textContent = 'Dark';
    } else {
      // Show sun icon for light mode
      themeIcon.innerHTML = `
        <circle cx="12" cy="12" r="5"></circle>
        <line x1="12" y1="1" x2="12" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="23"></line>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
        <line x1="1" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="12" x2="23" y2="12"></line>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
      `;
      themeLabel.textContent = 'Light';
    }
  }
}

// Update table count
function updateTableCount() {
  const countElement = document.getElementById('tableCount');
  if (!countElement) return;
  
  const total = uploadState.files.size;
  const completed = Array.from(uploadState.files.values()).filter(f => f.status === 'completed').length;
  
  if (completed > 0) {
    countElement.textContent = `${completed} completed / ${total} total`;
    document.getElementById('downloadAllBtn').disabled = false;
  } else {
    countElement.textContent = `${total} file${total !== 1 ? 's' : ''}`;
    document.getElementById('downloadAllBtn').disabled = true;
  }
}

// Download all results as a single JSON
function downloadAllResults() {
  // Get all completed files with results - simplified format
  const completedFiles = Array.from(uploadState.files.values())
    .filter(f => f.status === 'completed' && f.result)
    .map(f => ({
      filename: f.name,
      type: f.type,
      decision: f.decision || 'UNKNOWN',
      score: f.score !== undefined ? f.score : 0
    }));
  
  if (completedFiles.length === 0) {
    alert('No completed results to download');
    return;
  }
  
  // Create blob and download - just the array of results
  const blob = new Blob([JSON.stringify(completedFiles, null, 2)], {
    type: 'application/json'
  });
  
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  
  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  a.download = `all-results-${timestamp}.json`;
  
  // Trigger download
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  // Clean up
  URL.revokeObjectURL(url);
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initializeTheme();
  initializeApp();
});
