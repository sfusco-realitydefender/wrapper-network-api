// State management
const uploadState = {
  files: new Map(),
  currentResult: null,
  currentAudio: null,
  currentImageModal: null,
  currentMediaModal: null,
  modelStatus: {
    image: "checking",
    audio: "checking",
    video: "checking",
  },
};

const HEATMAP_TINT_FILTERS = {
  thermal:
    "sepia(1) saturate(7) hue-rotate(-20deg) contrast(1.3) brightness(1.05)",
  cool: "sepia(1) saturate(8) hue-rotate(145deg) contrast(1.25) brightness(1.05)",
  mono: "grayscale(1) contrast(1.5) brightness(1.1)",
};
const HEATMAP_SOURCE_MODEL = "rd-pine-img";
const HEATMAP_FULL_FRAME_MODEL = "rd-full-pine-img";

function getImageAnalysisResult(result) {
  if (!result) return null;
  if (result.results && Array.isArray(result.results)) {
    return result.results[0] || null;
  }
  return result;
}

function getImageMetadata(result) {
  return getImageAnalysisResult(result)?.metadata || null;
}

function getImageBboxes(result) {
  const metadata = getImageMetadata(result);
  return Array.isArray(metadata?.bboxes) ? metadata.bboxes : [];
}

function getImageRequestId(result) {
  return (
    result?.request_id || getImageAnalysisResult(result)?.request_id || null
  );
}

function getImageResultMap(result) {
  if (result?.results && typeof result.results === "object") {
    if (!Array.isArray(result.results)) return result.results;
    return result.results[0] || {};
  }
  return result || {};
}

function getPrimaryImageDecision(result) {
  const imageResults = getImageResultMap(result);
  const preferredModelOrder = ["rd-img-ensemble", "rd-ensemble", "rd-pine-img"];
  const modelName =
    preferredModelOrder.find((key) => imageResults?.[key]) ||
    Object.keys(imageResults || {}).find(
      (key) =>
        imageResults?.[key] && typeof imageResults[key] === "object" && "decision" in imageResults[key],
    ) ||
    null;

  if (!modelName) {
    return { decision: "UNKNOWN", score: null };
  }

  const modelResult = imageResults[modelName] || {};
  const scoreCandidate =
    modelResult.score ?? modelResult.raw_score ?? modelResult.probability ?? null;

  return {
    decision: modelResult.decision || modelResult.prediction || "UNKNOWN",
    score: Number.isFinite(Number(scoreCandidate)) ? Number(scoreCandidate) : null,
  };
}

function normalizeHeatmapPath(heatmapPath, result) {
  if (typeof heatmapPath !== "string" || !heatmapPath) return "";
  if (heatmapPath.startsWith("/api/heatmaps/")) return heatmapPath;

  const requestId = getImageRequestId(result);
  const cleanPath = heatmapPath.split("?")[0];
  const fileName = cleanPath.split("/").pop();
  if (!requestId || !fileName) return heatmapPath;

  return `/api/heatmaps/${requestId}/${fileName}`;
}

function getImageHeatmapOptions(result) {
  const metadata = getImageMetadata(result);
  if (!metadata) return { fullFrame: false, facial: false };

  const fullFramePath = getFullFrameHeatmapPath(metadata);
  const hasFullFrame = typeof fullFramePath === "string" && !!fullFramePath;

  const bboxes = Array.isArray(metadata?.bboxes) ? metadata.bboxes : [];
  const hasFacial = bboxes.some((bboxData) => {
    const facialPath = bboxData?.heatmaps?.[HEATMAP_SOURCE_MODEL];
    return typeof facialPath === "string" && !!facialPath && !!bboxData?.bbox;
  });

  return { fullFrame: hasFullFrame, facial: hasFacial };
}

function getFullFrameHeatmapPath(metadata) {
  const fullFrameHeatmaps = metadata?.full_frame?.heatmaps;
  if (!fullFrameHeatmaps || typeof fullFrameHeatmaps !== "object") return null;

  const preferredByKey =
    fullFrameHeatmaps[HEATMAP_FULL_FRAME_MODEL] ||
    fullFrameHeatmaps[HEATMAP_SOURCE_MODEL];
  if (typeof preferredByKey === "string" && preferredByKey) return preferredByKey;

  const entries = Object.values(fullFrameHeatmaps).filter(
    (value) => typeof value === "string" && value,
  );
  const resizedMatch = entries.find((value) =>
    /heatmap_resized/i.test(value),
  );
  if (resizedMatch) return resizedMatch;

  return entries[0] || null;
}

function getImageDimensions(result, fileData) {
  const metadata = getImageMetadata(result);
  const width = metadata?.image?.width || metadata?.width || 1;
  const height = metadata?.image?.height || metadata?.height || 1;

  return {
    width: Number(width) || 1,
    height: Number(height) || 1,
  };
}

function getBboxPoints(bbox) {
  if (!bbox) return null;

  const orderedPoints = [
    bbox.top_left,
    bbox.top_right,
    bbox.bottom_right,
    bbox.bottom_left,
  ];

  if (orderedPoints.some((point) => !point)) return null;

  const points = orderedPoints.map((point) => ({
    x: Number(point.x),
    y: Number(point.y),
  }));

  if (points.some((point) => Number.isNaN(point.x) || Number.isNaN(point.y))) {
    return null;
  }

  return points;
}

function getBboxDecision(bboxData) {
  return bboxData?.conclusions?.["rd-pine-img"]?.decision || "UNKNOWN";
}

function getBboxColor(decision) {
  if (decision === "ARTIFICIAL") {
    return {
      stroke: "#dc2626",
      label: "var(--bbox-artificial-label)",
    };
  }

  if (decision === "AUTHENTIC") {
    return {
      stroke: "#16a34a",
      label: "var(--bbox-authentic-label)",
    };
  }

  return {
    stroke: "#6b7280",
    label: "var(--bbox-neutral-label)",
  };
}

function getScaledBboxPoints(
  bbox,
  dimensions,
  displayedWidth,
  displayedHeight,
) {
  const points = getBboxPoints(bbox);
  if (!points) return null;

  return points.map((point) => ({
    x: (point.x / dimensions.width) * displayedWidth,
    y: (point.y / dimensions.height) * displayedHeight,
  }));
}

function renderImageBboxes(fileData) {
  const overlay = document.getElementById("modalImageOverlay");
  if (!overlay) return;

  overlay.innerHTML = "";
}

function getHeatmapLayersForMode(result, mode) {
  const metadata = getImageMetadata(result);
  if (!metadata || !mode) return [];

  const layers = [];

  if (mode === "full-frame") {
    const fullFramePath = getFullFrameHeatmapPath(metadata);
    if (typeof fullFramePath !== "string" || !fullFramePath) return layers;

    layers.push({
      type: "full-frame",
      path: normalizeHeatmapPath(fullFramePath, result),
      bbox: null,
    });
    return layers;
  }

  if (mode === "facial") {
    const bboxes = Array.isArray(metadata?.bboxes) ? metadata.bboxes : [];
    bboxes.forEach((bboxData) => {
      const bboxPath = bboxData?.heatmaps?.[HEATMAP_SOURCE_MODEL];
      if (typeof bboxPath !== "string" || !bboxPath || !bboxData?.bbox) return;

      layers.push({
        type: "bbox",
        path: normalizeHeatmapPath(bboxPath, result),
        bbox: bboxData.bbox,
      });
    });
  }

  return layers;
}

function renderActiveHeatmapOverlays(fileData, mode = "") {
  const heatmapOverlay = document.getElementById("modalHeatmapOverlay");
  const modalImage = document.getElementById("modalImage");
  if (!heatmapOverlay || !modalImage) return;

  heatmapOverlay.innerHTML = "";

  const displayedWidth = modalImage.clientWidth;
  const displayedHeight = modalImage.clientHeight;
  if (!displayedWidth || !displayedHeight) return;

  heatmapOverlay.style.width = `${displayedWidth}px`;
  heatmapOverlay.style.height = `${displayedHeight}px`;

  if (!mode) return;

  const dimensions = getImageDimensions(fileData.result, fileData);
  const layers = getHeatmapLayersForMode(fileData.result, mode);

  layers.forEach((layer) => {
    const img = document.createElement("img");
    img.className =
      layer.type === "full-frame"
        ? "modal-heatmap-layer full-frame"
        : "modal-heatmap-layer bbox";
    img.alt = "";
    img.src = layer.path;

    if (layer.type === "bbox") {
      const scaledPoints = getScaledBboxPoints(
        layer.bbox,
        dimensions,
        displayedWidth,
        displayedHeight,
      );
      if (!scaledPoints) return;

      const xs = scaledPoints.map((point) => point.x);
      const ys = scaledPoints.map((point) => point.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const boxWidth = maxX - minX;
      const boxHeight = maxY - minY;

      if (boxWidth <= 1 || boxHeight <= 1) return;

      img.style.left = `${minX}px`;
      img.style.top = `${minY}px`;
      img.style.width = `${boxWidth}px`;
      img.style.height = `${boxHeight}px`;

      const clipPoints = scaledPoints
        .map((point) => {
          const x = ((point.x - minX) / boxWidth) * 100;
          const y = ((point.y - minY) / boxHeight) * 100;
          return `${x}% ${y}%`;
        })
        .join(", ");
      img.style.clipPath = `polygon(${clipPoints})`;
    }

    heatmapOverlay.appendChild(img);
  });

  applyHeatmapVisualSettings();
}

function setActiveHeatmap(mode = "", buttonId = "") {
  const heatmapOverlay = document.getElementById("modalHeatmapOverlay");
  const buttons = document.querySelectorAll(".heatmap-toggle");
  if (!heatmapOverlay) return;

  buttons.forEach((button) => {
    const isActive = button.dataset.buttonId === buttonId;
    button.classList.toggle("active", isActive);
  });

  if (!mode) {
    heatmapOverlay.innerHTML = "";

    if (uploadState.currentImageModal) {
      uploadState.currentImageModal.activeHeatmapMode = null;
      uploadState.currentImageModal.activeHeatmapButtonId = null;
    }
    return;
  }

  if (uploadState.currentImageModal?.fileData) {
    renderActiveHeatmapOverlays(uploadState.currentImageModal.fileData, mode);
  }

  if (uploadState.currentImageModal) {
    uploadState.currentImageModal.activeHeatmapMode = mode;
    uploadState.currentImageModal.activeHeatmapButtonId = buttonId;
  }
}

function applyHeatmapVisualSettings() {
  const heatmapLayers = document.querySelectorAll(".modal-heatmap-layer");
  const opacityInput = document.getElementById("heatmapOpacity");
  const tintSelect = document.getElementById("heatmapTint");

  const opacityValue =
    opacityInput?.value ||
    uploadState.currentImageModal?.heatmapOpacity ||
    "0.7";
  const tintValue =
    tintSelect?.value ||
    uploadState.currentImageModal?.heatmapTint ||
    "thermal";

  heatmapLayers.forEach((heatmapLayer) => {
    heatmapLayer.style.opacity = String(opacityValue);
    heatmapLayer.style.filter =
      HEATMAP_TINT_FILTERS[tintValue] || HEATMAP_TINT_FILTERS.thermal;
  });

  if (uploadState.currentImageModal) {
    uploadState.currentImageModal.heatmapOpacity = String(opacityValue);
    uploadState.currentImageModal.heatmapTint = tintValue;
  }
}

function renderHeatmapControls(fileData) {
  const controls = document.getElementById("heatmapControls");
  const buttonsContainer = document.getElementById("heatmapButtons");
  if (!controls || !buttonsContainer) return;

  buttonsContainer.innerHTML = "";

  const options = getImageHeatmapOptions(fileData.result);
  if (!options.fullFrame && !options.facial) {
    controls.hidden = true;
    setActiveHeatmap();
    return;
  }

  controls.hidden = false;

  const buttonDefinitions = [
    {
      id: "full-frame",
      label: "Full Frame Heatmap",
      enabled: options.fullFrame,
    },
    {
      id: "facial",
      label: "Facial Heatmap",
      enabled: options.facial,
    },
  ];

  buttonDefinitions.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "heatmap-toggle";
    button.dataset.buttonId = option.id;
    button.textContent = option.label;
    button.disabled = !option.enabled;
    button.addEventListener("click", () => {
      if (!option.enabled) return;
      setActiveHeatmap(option.id, option.id);
    });
    buttonsContainer.appendChild(button);
  });

  const activeMode = uploadState.currentImageModal?.activeHeatmapMode || "";
  const activeButton = uploadState.currentImageModal?.activeHeatmapButtonId;

  const canRestore =
    (activeMode === "full-frame" && options.fullFrame) ||
    (activeMode === "facial" && options.facial);
  if (canRestore && activeButton) {
    setActiveHeatmap(activeMode, activeButton);
  } else if (options.fullFrame) {
    setActiveHeatmap("full-frame", "full-frame");
  } else if (options.facial) {
    setActiveHeatmap("facial", "facial");
  } else {
    setActiveHeatmap();
  }
}

// DOM elements
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const uploadTable = document.getElementById("uploadTable");
const uploadTableBody = document.getElementById("uploadTableBody");
const resultModal = document.getElementById("resultModal");
const resultContent = document.getElementById("resultContent");

// Initialize event listeners
function initializeApp() {
  // Verify elements exist
  if (!dropzone || !fileInput) {
    console.error("Required elements not found:", {
      dropzone: !!dropzone,
      fileInput: !!fileInput,
    });
    return;
  }

  // Dropzone click handler - trigger file input
  dropzone.addEventListener("click", function (e) {
    e.preventDefault();
    // Programmatically click the file input
    fileInput.click();
    console.log("Dropzone clicked, triggering file input");
  });

  // Drag and drop events
  dropzone.addEventListener("dragover", handleDragOver);
  dropzone.addEventListener("dragleave", handleDragLeave);
  dropzone.addEventListener("drop", handleDrop);

  // File input change
  fileInput.addEventListener("change", handleFileSelect);

  // Prevent default drag behavior on document
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => e.preventDefault());

  const heatmapOpacity = document.getElementById("heatmapOpacity");
  const heatmapTint = document.getElementById("heatmapTint");
  heatmapOpacity?.addEventListener("input", applyHeatmapVisualSettings);
  heatmapTint?.addEventListener("change", applyHeatmapVisualSettings);

  window.addEventListener("resize", () => {
    if (uploadState.currentImageModal?.fileData) {
      const { fileData, activeHeatmapMode } = uploadState.currentImageModal;
      renderImageBboxes(fileData);
      renderActiveHeatmapOverlays(fileData, activeHeatmapMode || "");
    }
  });

  // Start health checks
  checkModelHealth();
  setInterval(checkModelHealth, 10000); // Check every 10 seconds
}

// Drag and drop handlers
function handleDragOver(e) {
  e.preventDefault();
  dropzone.classList.add("dragover");
}

function handleDragLeave(e) {
  e.preventDefault();
  if (e.target === dropzone) {
    dropzone.classList.remove("dragover");
  }
}

function handleDrop(e) {
  e.preventDefault();
  dropzone.classList.remove("dragover");

  const files = Array.from(e.dataTransfer.files);
  processFiles(files);
}

function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  processFiles(files);
  // Reset input
  fileInput.value = "";
}

// File processing
function processFiles(files) {
  files.forEach((file) => {
    if (isValidFile(file)) {
      const fileId = generateId();
      const fileData = {
        id: fileId,
        file: file,
        name: file.name,
        size: formatFileSize(file.size),
        type: getFileType(file),
        status: "uploading",
        result: null,
        error: null,
        decision: null,
        score: null,
        uploadedAt: new Date().toISOString(),
      };

      uploadState.files.set(fileId, fileData);
      addTableRow(fileData);
      uploadFile(fileData);
    } else {
      alert(
        `Invalid file type: ${file.name}. Please upload image, audio, or video files only.`,
      );
    }
  });
}

function isValidFile(file) {
  const imageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const audioTypes = [
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/x-m4a",
    "audio/mp4",
  ];
  const videoTypes = [
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",
    "video/webm",
  ];

  return (
    imageTypes.includes(file.type) ||
    audioTypes.includes(file.type) ||
    videoTypes.includes(file.type) ||
    (file.type === "" &&
      (file.name.endsWith(".mp3") ||
        file.name.endsWith(".wav") ||
        file.name.endsWith(".m4a"))) ||
    (file.type === "" &&
      (file.name.endsWith(".mp4") ||
        file.name.endsWith(".mov") ||
        file.name.endsWith(".avi") ||
        file.name.endsWith(".webm")))
  );
}

function getFileType(file) {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/") || file.name.match(/\.(mp3|wav|m4a)$/i))
    return "audio";
  if (
    file.type.startsWith("video/") ||
    file.name.match(/\.(mp4|mov|avi|webm)$/i)
  )
    return "video";
  return "unknown";
}

// File upload
async function uploadFile(fileData) {
  const formData = new FormData();

  // Use different field names for different types as expected by the backend
  let fieldName, endpoint;
  if (fileData.type === "image") {
    fieldName = "image";
    endpoint = "/analyze";
  } else if (fileData.type === "audio") {
    fieldName = "audio";
    endpoint = "/analyze-audio";
  } else if (fileData.type === "video") {
    fieldName = "video";
    endpoint = "/analyze-video";
  }
  formData.append(fieldName, fileData.file);

  try {
    // Update status to processing
    updateFileStatus(fileData.id, "processing");

    const response = await fetch(endpoint, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Upload failed");
    }

    const result = await response.json();

    // Extract decision and score based on file type
    if (fileData.type === "image") {
      const imageSummary = getPrimaryImageDecision(result);
      fileData.decision = imageSummary.decision;
      fileData.score = imageSummary.score;
    } else if (fileData.type === "audio") {
      // Check for different possible field names in audio response
      fileData.decision =
        result.final_decision ||
        result.decision ||
        result.prediction ||
        "UNKNOWN";
      fileData.score =
        result.final_probability || result.probability || result.score || 0;

      // Log the result structure for debugging
      console.log("Audio result structure:", result);
    } else if (fileData.type === "video") {
      // Check for different possible field names in video response
      fileData.decision =
        result.final_decision ||
        result.decision ||
        result.prediction ||
        "UNKNOWN";
      fileData.score =
        result.final_score ||
        result.final_probability ||
        result.probability ||
        result.score ||
        0;

      // Log the result structure for debugging
      console.log("Video result structure:", result);
    }

    // Update file data
    fileData.result = result;
    fileData.status = "completed";
    fileData.error = null; // Clear any previous errors

    // Make sure we have valid decision and score before updating
    if (
      fileData.decision === "UNKNOWN" &&
      (fileData.type === "audio" || fileData.type === "video")
    ) {
      console.warn(
        `${fileData.type} processing completed but decision/score fields not found in response`,
      );
    }

    updateFileStatus(fileData.id, "completed", result);
  } catch (error) {
    console.error("Upload error:", error);

    // Check if it's a timeout error
    let errorMessage = error.message || "Upload failed";
    if (error.response?.status === 504) {
      errorMessage =
        "Processing timeout - the file may be too large or complex. Please try again.";
    }

    fileData.error = errorMessage;
    fileData.status = "error";
    updateFileStatus(fileData.id, "error", null, errorMessage);
  }
}

// Table management
function addTableRow(fileData) {
  // Show table and header
  uploadTable.classList.add("has-data");
  document.getElementById("tableHeader").style.display = "flex";
  updateTableCount();

  const row = document.createElement("tr");
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
  const decisionCell = row.querySelector(".decision-cell");
  if (decisionCell) {
    decisionCell.innerHTML = getDecisionHTML(fileData.decision);
  }

  // Update score cell
  const scoreCell = row.querySelector(".score-cell");
  if (scoreCell) {
    scoreCell.innerHTML = getScoreHTML(fileData.score);
  }

  // Update status cell
  const statusCell = row.querySelector(".status-cell");
  statusCell.innerHTML = getStatusHTML(status, error);

  // Update actions cell
  const actionsCell = row.querySelector(".actions-cell");
  actionsCell.innerHTML = getActionsHTML(fileData);

  // Update table count
  updateTableCount();
}

function getPreviewHTML(fileData) {
  if (fileData.type === "image" && fileData.file) {
    const url = URL.createObjectURL(fileData.file);
    // Clean up object URL after image loads
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return `<img src="${url}" alt="${fileData.name}" class="preview-image">`;
  } else if (fileData.type === "video" && fileData.file) {
    const url = URL.createObjectURL(fileData.file);
    // Clean up object URL after video loads
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return `<video src="${url}" class="preview-image" muted></video>`;
  } else if (fileData.type === "audio") {
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
    case "uploading":
      return `
        <div class="status uploading">
          <div class="spinner"></div>
          <span>Uploading...</span>
        </div>
      `;
    case "processing":
      return `
        <div class="status processing">
          <div class="spinner"></div>
          <span>Processing...</span>
        </div>
      `;
    case "completed":
      return `
        <div class="status completed">
          <svg class="status-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <span>Done</span>
        </div>
      `;
    case "error":
      return `
        <div class="status error" title="${error || "Upload failed"}">
          <svg class="status-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <span>Error</span>
        </div>
      `;
    default:
      return "<span>Unknown</span>";
  }
}

function getActionsHTML(fileData) {
  if (fileData.status === "completed" && fileData.result) {
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
  } else if (fileData.status === "error") {
    return `
      <button class="btn-icon btn-secondary" onclick="retryUpload('${fileData.id}')" title="Retry Upload">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
    `;
  }
  return "";
}

// Helper functions for decision and score display
function getDecisionHTML(decision) {
  if (!decision) return '<span class="decision-pending">-</span>';

  const className =
    decision === "ARTIFICIAL"
      ? "decision-artificial"
      : decision === "AUTHENTIC"
        ? "decision-authentic"
        : "decision-unknown";

  return `<span class="decision ${className}">${decision}</span>`;
}

function getScoreHTML(score) {
  if (score === null || score === undefined)
    return '<span class="score-pending">-</span>';

  const percentage = (score * 100).toFixed(1);
  const className =
    score >= 0.7 ? "score-high" : score >= 0.3 ? "score-medium" : "score-low";

  return `<span class="score ${className}">${percentage}%</span>`;
}

// Result modal
function showResult(fileId) {
  const fileData = uploadState.files.get(fileId);
  if (!fileData || !fileData.result) return;

  uploadState.currentResult = fileData.result;
  resultContent.textContent = JSON.stringify(fileData.result, null, 2);
  resultModal.classList.add("show");
}

function closeResultModal() {
  resultModal.classList.remove("show");
  uploadState.currentResult = null;
}

function copyResult(event) {
  if (!uploadState.currentResult) return;

  const text = JSON.stringify(uploadState.currentResult, null, 2);
  const button = event
    ? event.target
    : document.querySelector(".modal-footer .btn-secondary");

  navigator.clipboard
    .writeText(text)
    .then(() => {
      // Show temporary success message
      const originalText = button.textContent;
      button.textContent = "Copied!";
      button.classList.add("btn-success");
      setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove("btn-success");
      }, 2000);
    })
    .catch((err) => {
      console.error("Failed to copy:", err);
      // Fallback method for older browsers or when clipboard API fails
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        const originalText = button.textContent;
        button.textContent = "Copied!";
        button.classList.add("btn-success");
        setTimeout(() => {
          button.textContent = originalText;
          button.classList.remove("btn-success");
        }, 2000);
      } catch (err) {
        alert(
          "Failed to copy to clipboard. Please try selecting and copying manually.",
        );
      }
      document.body.removeChild(textArea);
    });
}

// Retry upload
function retryUpload(fileId) {
  const fileData = uploadState.files.get(fileId);
  if (!fileData) return;

  fileData.status = "uploading";
  fileData.error = null;
  updateFileStatus(fileId, "uploading");
  uploadFile(fileData);
}

// Media preview handlers
function handlePreviewClick(fileId) {
  const fileData = uploadState.files.get(fileId);
  if (!fileData) return;

  if (fileData.type === "image") {
    showImagePreview(fileData);
  } else if (fileData.type === "audio" || fileData.type === "video") {
    showMediaPreview(fileData);
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

  // Close any open audio/video preview modal
  if (uploadState.currentMediaModal) {
    closeMediaModal();
  }

  const imageModal = document.getElementById("imageModal");
  const modalImage = document.getElementById("modalImage");
  const heatmapOverlay = document.getElementById("modalHeatmapOverlay");
  const controls = document.getElementById("heatmapControls");
  const buttonsContainer = document.getElementById("heatmapButtons");
  const heatmapOpacity = document.getElementById("heatmapOpacity");
  const heatmapTint = document.getElementById("heatmapTint");

  const url = URL.createObjectURL(fileData.file);
  modalImage.onload = () => {
    renderImageBboxes(fileData);
    renderHeatmapControls(fileData);
  };
  modalImage.src = url;
  modalImage.alt = fileData.name;
  if (heatmapOverlay) heatmapOverlay.innerHTML = "";
  if (heatmapOpacity) heatmapOpacity.value = "0.7";
  if (heatmapTint) heatmapTint.value = "thermal";
  applyHeatmapVisualSettings();
  if (controls) controls.hidden = true;
  if (buttonsContainer) buttonsContainer.innerHTML = "";

  imageModal.classList.add("show");
  uploadState.currentImageModal = {
    fileData,
    url,
    activeHeatmapMode: null,
    activeHeatmapButtonId: null,
    heatmapOpacity: "0.7",
    heatmapTint: "thermal",
  };
}

function closeImageModal() {
  const imageModal = document.getElementById("imageModal");
  const overlay = document.getElementById("modalImageOverlay");
  const heatmapOverlay = document.getElementById("modalHeatmapOverlay");
  const controls = document.getElementById("heatmapControls");
  const buttonsContainer = document.getElementById("heatmapButtons");
  imageModal.classList.remove("show");

  if (uploadState.currentImageModal && uploadState.currentImageModal.url) {
    URL.revokeObjectURL(uploadState.currentImageModal.url);
  }

  if (overlay) overlay.innerHTML = "";
  if (heatmapOverlay) heatmapOverlay.innerHTML = "";
  if (controls) controls.hidden = true;
  if (buttonsContainer) buttonsContainer.innerHTML = "";

  uploadState.currentImageModal = null;
}

// Make closeImageModal available globally for the modal close button
window.closeImageModal = closeImageModal;

function showMediaPreview(fileData) {
  // Close any existing media modal before opening a new one
  if (uploadState.currentMediaModal) {
    closeMediaModal();
  }

  // Close image modal if open
  if (uploadState.currentImageModal) {
    closeImageModal();
  }

  // Stop any inline audio playback
  if (uploadState.currentAudio) {
    stopCurrentAudio();
  }

  const mediaModal = document.getElementById("mediaModal");
  const mediaModalTitle = document.getElementById("mediaModalTitle");
  const mediaPreviewContainer = document.getElementById(
    "mediaPreviewContainer",
  );
  if (!mediaModal || !mediaModalTitle || !mediaPreviewContainer) return;

  const url = URL.createObjectURL(fileData.file);
  mediaPreviewContainer.innerHTML = "";

  let mediaElement;
  if (fileData.type === "video") {
    mediaModalTitle.textContent = "Video Preview";
    mediaElement = document.createElement("video");
    mediaElement.controls = true;
    mediaElement.preload = "metadata";
    mediaElement.playsInline = true;
  } else {
    mediaModalTitle.textContent = "Audio Preview";
    mediaElement = document.createElement("audio");
    mediaElement.controls = true;
    mediaElement.preload = "metadata";
  }

  mediaElement.src = url;
  mediaElement.setAttribute("aria-label", fileData.name);
  mediaPreviewContainer.appendChild(mediaElement);
  mediaModal.classList.add("show");

  uploadState.currentMediaModal = {
    fileData,
    url,
    mediaElement,
  };
}

function closeMediaModal() {
  const mediaModal = document.getElementById("mediaModal");
  const mediaPreviewContainer = document.getElementById(
    "mediaPreviewContainer",
  );

  if (uploadState.currentMediaModal?.mediaElement) {
    uploadState.currentMediaModal.mediaElement.pause();
  }

  if (uploadState.currentMediaModal?.url) {
    URL.revokeObjectURL(uploadState.currentMediaModal.url);
  }

  if (mediaPreviewContainer) {
    mediaPreviewContainer.innerHTML = "";
  }

  mediaModal?.classList.remove("show");
  uploadState.currentMediaModal = null;
}

// Make closeMediaModal available globally for the modal close button
window.closeMediaModal = closeMediaModal;

function toggleAudioPlayback(fileData) {
  // If clicking on the same audio that's playing, pause it
  if (
    uploadState.currentAudio &&
    uploadState.currentAudio.fileId === fileData.id
  ) {
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
  const previewContainer = row.querySelector(".preview-container");
  previewContainer.classList.add("audio-playing");

  // Set up event listeners
  audio.addEventListener("ended", () => {
    stopCurrentAudio();
  });

  audio.addEventListener("pause", () => {
    if (
      uploadState.currentAudio &&
      uploadState.currentAudio.fileId === fileData.id
    ) {
      previewContainer.classList.remove("audio-playing");
    }
  });

  audio.addEventListener("play", () => {
    if (
      uploadState.currentAudio &&
      uploadState.currentAudio.fileId === fileData.id
    ) {
      previewContainer.classList.add("audio-playing");
    }
  });

  // Start playing
  audio.play();

  uploadState.currentAudio = {
    fileId: fileData.id,
    audio: audio,
    url: url,
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
    const previewContainer = row.querySelector(".preview-container");
    if (previewContainer) {
      previewContainer.classList.remove("audio-playing");
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
  // Check video model
  checkVideoModel();
}

async function checkImageModel() {
  try {
    const response = await fetch("/api/health/image");
    const data = await response.json();
    updateModelStatus("image", data.status, data.message);
  } catch (error) {
    updateModelStatus("image", "error", "Failed to check status");
  }
}

async function checkAudioModel() {
  try {
    const response = await fetch("/api/health/audio");
    const data = await response.json();
    updateModelStatus("audio", data.status, data.message);
  } catch (error) {
    updateModelStatus("audio", "error", "Failed to check status");
  }
}

async function checkVideoModel() {
  try {
    const response = await fetch("/api/health/video");
    const data = await response.json();
    updateModelStatus("video", data.status, data.message);
  } catch (error) {
    updateModelStatus("video", "error", "Failed to check status");
  }
}

function updateModelStatus(model, status, message) {
  uploadState.modelStatus[model] = status;

  const statusElement = document.getElementById(`${model}ModelStatus`);
  if (!statusElement) return;

  const statusIcon = statusElement.querySelector(".status-icon");
  const statusValue = statusElement.querySelector(".status-value");

  // Remove all status classes
  statusElement.classList.remove(
    "status-ready",
    "status-loading",
    "status-error",
    "status-busy",
  );

  // Update based on status
  if (status === "ready") {
    statusElement.classList.add("status-ready");
    statusIcon.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    `;
    statusValue.textContent = "Ready";
  } else if (status === "busy") {
    // Show as ready but with processing indicator
    statusElement.classList.add("status-ready");
    statusIcon.innerHTML = `
      <svg class="status-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
      </svg>
    `;
    statusValue.textContent = "Processing";
  } else if (status === "loading") {
    statusElement.classList.add("status-loading");
    statusIcon.innerHTML = `
      <svg class="status-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
      </svg>
    `;
    statusValue.textContent = "Loading...";
  } else {
    statusElement.classList.add("status-error");
    statusIcon.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    `;
    statusValue.textContent = "Offline";
  }

  // Add tooltip with message
  statusElement.title = message || "";
}

// Download JSON functionality
function downloadJSON(fileId) {
  const fileData = uploadState.files.get(fileId);
  if (!fileData || !fileData.result) return;

  // Create blob with formatted JSON
  const blob = new Blob([JSON.stringify(fileData.result, null, 2)], {
    type: "application/json",
  });

  // Create download link
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;

  // Generate filename with original name and timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const baseName = fileData.name.replace(/\.[^/.]+$/, ""); // Remove extension
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
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Theme management
function initializeTheme() {
  const themeToggle = document.getElementById("themeToggle");
  const themeIcon = document.getElementById("themeIcon");
  const themeLabel = themeToggle?.querySelector(".theme-label");

  // Check for saved theme preference or default to system preference
  const savedTheme = localStorage.getItem("theme");
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
  const currentTheme = savedTheme || systemTheme;

  // Apply initial theme
  document.documentElement.setAttribute("data-theme", currentTheme);
  updateThemeUI(currentTheme);

  // Theme toggle click handler
  themeToggle?.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const newTheme = current === "dark" ? "light" : "dark";

    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("theme", newTheme);
    updateThemeUI(newTheme);
  });

  // Listen for system theme changes
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (e) => {
      if (!localStorage.getItem("theme")) {
        const newTheme = e.matches ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", newTheme);
        updateThemeUI(newTheme);
      }
    });

  function updateThemeUI(theme) {
    if (!themeIcon || !themeLabel) return;

    if (theme === "dark") {
      // Show moon icon for dark mode
      themeIcon.innerHTML = `
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      `;
      themeLabel.textContent = "Dark";
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
      themeLabel.textContent = "Light";
    }
  }
}

// Update table count
function updateTableCount() {
  const countElement = document.getElementById("tableCount");
  if (!countElement) return;

  const total = uploadState.files.size;
  const completed = Array.from(uploadState.files.values()).filter(
    (f) => f.status === "completed",
  ).length;

  if (completed > 0) {
    countElement.textContent = `${completed} completed / ${total} total`;
    document.getElementById("downloadAllBtn").disabled = false;
  } else {
    countElement.textContent = `${total} file${total !== 1 ? "s" : ""}`;
    document.getElementById("downloadAllBtn").disabled = true;
  }
}

// Download all results as a single JSON
function downloadAllResults() {
  // Get all completed files with results - simplified format
  const completedFiles = Array.from(uploadState.files.values())
    .filter((f) => f.status === "completed" && f.result)
    .map((f) => ({
      filename: f.name,
      type: f.type,
      decision: f.decision || "UNKNOWN",
      score: f.score !== undefined ? f.score : 0,
    }));

  if (completedFiles.length === 0) {
    alert("No completed results to download");
    return;
  }

  // Create blob and download - just the array of results
  const blob = new Blob([JSON.stringify(completedFiles, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  a.download = `all-results-${timestamp}.json`;

  // Trigger download
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Clean up
  URL.revokeObjectURL(url);
}

// Initialize app when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  initializeTheme();
  initializeApp();
});
