const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const uploadUi = document.querySelector('.upload-ui');
const processingUi = document.getElementById('processing-ui');
const resultUi = document.getElementById('result-ui');
const fileListContainer = document.getElementById('file-list');
const processStatusText = document.getElementById('process-status');
const downloadAllBtn = document.getElementById('download-all');
const canvas = document.getElementById('conversion-canvas');
const ctx = canvas.getContext('2d');

let convertedFiles = []; // Store { name: string, dataUrl: string }

// Prevent default drag behaviors
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
    document.body.addEventListener(eventName, preventDefaults, false);
});

// Highlight drop zone
['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, highlight, false);
});

['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, unhighlight, false);
});

dropZone.addEventListener('drop', handleDrop, false);
fileInput.addEventListener('change', function() {
    handleFiles(this.files);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function highlight() {
    dropZone.classList.add('drag-over');
}

function unhighlight() {
    dropZone.classList.remove('drag-over');
}

function handleDrop(e) {
    const dt = e.dataTransfer;
    handleFiles(dt.files);
}

async function handleFiles(files) {
    if (files.length === 0) return;
    
    const validFiles = Array.from(files).filter(file => 
        file.type === 'image/webp' || file.name.toLowerCase().endsWith('.webp')
    );

    if (validFiles.length === 0) {
        alert('Vui lòng chọn các file định dạng WebP.');
        return;
    }

    // Prepare UI
    uploadUi.classList.add('hidden');
    processingUi.classList.remove('hidden');
    resultUi.classList.add('hidden');
    
    convertedFiles = [];
    fileListContainer.innerHTML = '';
    
    let processedCount = 0;
    const totalCount = validFiles.length;

    for (const file of validFiles) {
        processStatusText.innerText = `Đang xử lý ${processedCount + 1}/${totalCount}: ${file.name}`;
        try {
            const result = await processImage(file);
            convertedFiles.push(result);
            addFileToListUI(result);
        } catch (err) {
            console.error('Error processing file:', file.name, err);
        }
        processedCount++;
    }

    // Finalize UI
    processingUi.classList.add('hidden');
    resultUi.classList.remove('hidden');
    
    if (convertedFiles.length > 1) {
        downloadAllBtn.classList.remove('hidden');
    } else {
        downloadAllBtn.classList.add('hidden');
    }
}

function processImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        
        reader.onload = function(event) {
            const img = new Image();
            img.src = event.target.result;
            
            img.onload = function() {
                canvas.width = img.width;
                canvas.height = img.height;
                
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
                
                const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.90);
                const jpegName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
                
                resolve({
                    originalName: file.name,
                    name: jpegName,
                    dataUrl: jpegDataUrl,
                    originalDataUrl: event.target.result
                });
            };
            
            img.onerror = () => reject(new Error('Failed to load image'));
        };
        
        reader.onerror = () => reject(new Error('Failed to read file'));
    });
}

function addFileToListUI(fileObj) {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
        <div class="file-thumb">
            <img src="${fileObj.dataUrl}" alt="Preview">
        </div>
        <div class="file-info">
            <span class="file-name" title="${fileObj.name}">${fileObj.name}</span>
            <span class="file-meta">WebP &rarr; JPEG</span>
        </div>
        <div class="file-actions">
            <a href="${fileObj.dataUrl}" download="${fileObj.name}" class="btn btn-success" style="padding: 8px 16px; font-size: 0.8rem;">Tải xuống</a>
        </div>
    `;
    fileListContainer.appendChild(item);
}

downloadAllBtn.onclick = async function() {
    if (convertedFiles.length === 0) return;
    
    const zip = new JSZip();
    const folder = zip.folder("converted_images");
    
    convertedFiles.forEach(file => {
        // Extract base64 content
        const base64Content = file.dataUrl.split(',')[1];
        folder.file(file.name, base64Content, {base64: true});
    });
    
    const content = await zip.generateAsync({type: "blob"});
    saveAs(content, "converted_images.zip");
};

function resetConverter() {
    uploadUi.classList.remove('hidden');
    processingUi.classList.add('hidden');
    resultUi.classList.add('hidden');
    fileInput.value = '';
    convertedFiles = [];
    fileListContainer.innerHTML = '';
}
