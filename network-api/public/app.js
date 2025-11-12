// State management
const uploadState = {
  files: new Map(),
  currentResult: null
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
  // Dropzone events
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', handleDragOver);
  dropzone.addEventListener('dragleave', handleDragLeave);
  dropzone.addEventListener('drop', handleDrop);
  
  // File input change
  fileInput.addEventListener('change', handleFileSelect);
  
  // Prevent default drag behavior on document
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
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
        error: null
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
    
    // Update file data
    fileData.result = result;
    fileData.status = 'completed';
    updateFileStatus(fileData.id, 'completed', result);
    
  } catch (error) {
    console.error('Upload error:', error);
    fileData.error = error.message;
    fileData.status = 'error';
    updateFileStatus(fileData.id, 'error', null, error.message);
  }
}

// Table management
function addTableRow(fileData) {
  // Show table
  uploadTable.classList.add('has-data');
  
  const row = document.createElement('tr');
  row.id = `row-${fileData.id}`;
  row.innerHTML = `
    <td>
      <div class="preview-container">
        ${getPreviewHTML(fileData)}
      </div>
    </td>
    <td>${escapeHtml(fileData.name)}</td>
    <td><span class="file-type ${fileData.type}">${fileData.type}</span></td>
    <td>${fileData.size}</td>
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
  
  // Update status cell
  const statusCell = row.querySelector('.status-cell');
  statusCell.innerHTML = getStatusHTML(status, error);
  
  // Update actions cell
  const actionsCell = row.querySelector('.actions-cell');
  actionsCell.innerHTML = getActionsHTML(fileData);
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
      <button class="btn btn-primary" onclick="showResult('${fileData.id}')">
        Inspect
      </button>
    `;
  } else if (fileData.status === 'error') {
    return `
      <button class="btn btn-secondary" onclick="retryUpload('${fileData.id}')">
        Retry
      </button>
    `;
  }
  return '';
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

function copyResult() {
  if (!uploadState.currentResult) return;
  
  const text = JSON.stringify(uploadState.currentResult, null, 2);
  navigator.clipboard.writeText(text).then(() => {
    // Show temporary success message
    const originalText = event.target.textContent;
    event.target.textContent = 'Copied!';
    setTimeout(() => {
      event.target.textContent = originalText;
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy:', err);
    alert('Failed to copy to clipboard');
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

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', initializeApp);
