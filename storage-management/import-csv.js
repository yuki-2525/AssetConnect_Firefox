/**
 * storage-management/import-csv.js
 * CSVダウンロード履歴インポート機能
 */

// ストレージヘルパー関数（Firefox互換）
function getStorageLocal(keys) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

let fileInput = null;
let fileDropArea = null;
let previewArea = null;
let previewStats = null;
let previewItems = null;
let importButton = null;
let statusArea = null;
let mergeRadios = null;

let selectedFile = null;
let parsedData = null;

// 初期化関数
function initializeElements() {
  fileInput = document.getElementById('file-input');
  fileDropArea = document.getElementById('file-drop-area');
  previewArea = document.getElementById('preview-area');
  previewStats = document.getElementById('preview-stats');
  previewItems = document.getElementById('preview-items');
  importButton = document.getElementById('import-button');
  statusArea = document.getElementById('status-area');
  mergeRadios = document.getElementsByName('merge-mode');
  
  if (!fileInput || !fileDropArea || !importButton) {
    console.error('Required DOM elements not found');
    return false;
  }
  return true;
}

// メッセージ取得関数
function getMessage(key, params = {}) {
  if (typeof TranslationManager !== 'undefined' && TranslationManager.getMessage) {
    return TranslationManager.getMessage(key, params);
  }
  // フォールバック
  const fallbackMessages = {
    'selectFilePrompt': 'ファイルを選択してください',
    'importNow': 'インポート',
  };
  return fallbackMessages[key] || key;
}

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOMContentLoaded event triggered');
  
  // DOM要素を初期化
  if (!initializeElements()) {
    return;
  }
  
  // UI テキスト更新
  updateUITexts();
  
  setupEventListeners();
});

// UI テキスト更新関数
function updateUITexts() {
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (typeof TranslationManager !== 'undefined' && TranslationManager.getMessage) {
      el.textContent = TranslationManager.getMessage(key) || el.textContent;
    }
  });
}

function setupEventListeners() {
  console.log('Setting up event listeners');
  
  if (!fileDropArea) {
    console.error('fileDropArea is null');
    return;
  }
  
  // ドラッグ＆ドロップ
  fileDropArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileDropArea.classList.add('dragover');
  });

  fileDropArea.addEventListener('dragleave', () => {
    fileDropArea.classList.remove('dragover');
  });

  fileDropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    fileDropArea.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelection(files[0]);
    }
  });

  // クリックで開く
  fileDropArea.addEventListener('click', () => {
    console.log('File drop area clicked');
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    console.log('File input changed', e.target.files.length);
    if (e.target.files.length > 0) {
      handleFileSelection(e.target.files[0]);
    }
  });

  // インポートボタン
  importButton.addEventListener('click', performImport);
}

function handleFileSelection(file) {
  selectedFile = file;
  
  // ファイル読み込み
  const reader = new FileReader();
  
  reader.onerror = () => {
    showStatus('ファイル読み込みエラーが発生しました', 'error');
    console.error('FileReader error');
  };
  
  reader.onload = (event) => {
    const csvText = event.target.result;
    handleCSVContent(csvText);
  };
  
  reader.readAsText(file, 'UTF-8');
}

function handleCSVContent(csvText) {
  try {
    // CSV解析
    const parsed = parseCSV(csvText);
    
    if (!parsed || parsed.items.length === 0) {
      showStatus('有効なCSVレコードが見つかりません', 'error');
      return;
    }
    
    parsedData = parsed;
    
    // プレビュー表示
    showPreview(parsed.items);
    
    // インポートボタンを有効化
    importButton.disabled = false;
    importButton.textContent = getMessage('importNow');
    
    showStatus(`${parsed.items.length}件のレコードが見つかりました`, 'info');
  } catch (error) {
    console.error('CSV parse error:', error);
    showStatus(`解析エラー: ${error.message}`, 'error');
  }
}

function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  
  if (lines.length < 2) {
    throw new Error('CSVファイルが空です');
  }
  
  // ヘッダー判定
  const headerLine = lines[0];
  const columns = headerLine.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
  
  const items = [];
  let format = null;
  
  // 2行目以降を処理
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const fields = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(f => f.replaceAll(/^"|"$/g, '').trim());
    
    if (fields.length === 2 && fields[0].startsWith('http')) {
      // レガシー形式: 2列の特殊フォーマット
      const url = fields[0];
      const metadata = fields[1];
      
      const parts = metadata.split('|');
      if (parts.length >= 4) {
        items.push({
          url: url,
          timestamp: parts[0] || '',
          boothID: parts[1] || '',
          title: parts[2] || '',
          filename: parts[3] || '',
          free: false,
          registered: false
        });
        format = 'legacy';
      }
    } else if (fields.length >= 6) {
      // CSV形式（6列以上）
      if (!format) {
        format = fields.length >= 7 ? 'v1.3.3+' : 'v1.3.3-';
      }
      
      // registered フィールド処理：string → boolean に変換
      let registered = false;
      if (fields[6]) {
        const registeredStr = (fields[6] || '').toLowerCase();
        registered = registeredStr === 'true';
      }
      
      items.push({
        url: fields[0] || '',
        timestamp: fields[1] || '',
        boothID: fields[2] || '',
        title: fields[3] || '',
        filename: fields[4] || '',
        free: (fields[5] || '').toLowerCase() === 'true',
        registered: registered
      });
    }
  }
  
  return {
    format: format || 'unknown',
    items: items
  };
}

function showPreview(items) {
  const preview = items.slice(0, 5);
  
  previewStats.textContent = `合計 ${items.length} 件`;
  previewItems.textContent = '';
  
  preview.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'preview-item';
    
    const strong = document.createElement('strong');
    strong.textContent = `${index + 1}.`;
    div.appendChild(strong);
    
    const text = document.createTextNode(` ${item.title || '（タイトルなし）'} `);
    div.appendChild(text);
    
    const small = document.createElement('small');
    small.style.color = '#999';
    small.textContent = `${item.url.substring(0, 50)}${item.url.length > 50 ? '...' : ''}`;
    div.appendChild(small);
    
    previewItems.appendChild(div);
  });
  
  if (items.length > 5) {
    const more = document.createElement('div');
    more.className = 'preview-item';
    more.style.fontStyle = 'italic';
    more.textContent = `+ 他 ${items.length - 5} 件`;
    previewItems.appendChild(more);
  }
  
  previewArea.style.display = 'block';
}

async function performImport() {
  if (!parsedData || parsedData.items.length === 0) {
    showStatus('インポートするデータがありません', 'error');
    return;
  }
  
  importButton.disabled = true;
  
  try {
    showStatus('インポート中...', 'info');
    
    // マージモード取得
    const mergeMode = Array.from(mergeRadios).find(r => r.checked).value;
    
    // 既存データを取得
    const result = await getStorageLocal({ downloadHistory: [] });
    const downloadHistory = result.downloadHistory || [];
    
    if (mergeMode === 'replace') {
      // 置き換え
      await new Promise((resolve, reject) => {
        chrome.storage.local.set({ downloadHistory: parsedData.items }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });
      showStatus(`✓ インポート完了！${parsedData.items.length}件のレコードで置き換えました`, 'success');
    } else {
      // マージ（skip: 既存を保持）
      const existingUrls = new Set(downloadHistory.map(item => item.url));
      let addedCount = 0;
      
      for (const item of parsedData.items) {
        if (!existingUrls.has(item.url)) {
          downloadHistory.push(item);
          addedCount++;
        }
      }
      
      await new Promise((resolve, reject) => {
        chrome.storage.local.set({ downloadHistory: downloadHistory }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });
      
      showStatus(`✓ インポート完了！${addedCount}件の新しいレコードを追加しました`, 'success');
    }
    
    // 2秒後にウィンドウを閉じる
    setTimeout(() => {
      window.close();
    }, 2000);
    
  } catch (error) {
    console.error('Import error:', error);
    showStatus(`インポートエラー: ${error.message || error}`, 'error');
    importButton.disabled = false;
  }
}

function showStatus(message, type) {
  statusArea.className = `status-area status-${type}`;
  statusArea.style.display = 'block';
  statusArea.textContent = message;
  
  // Auto-hide info messages after 5 seconds
  if (type === 'info') {
    setTimeout(() => {
      statusArea.style.display = 'none';
    }, 5000);
  }
}
