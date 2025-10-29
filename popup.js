// Video DownloadHelper - Popup Script

class VideoDownloadHelper {
    constructor() {
        this.videos = [];
        this.bindEvents();
    }

    async init() {
        try {
            await this.scanForVideos();
        } catch (error) {
            console.error('Initialization error:', error);
            this.showError('Lỗi khởi tạo extension: ' + error.message);
        }
    }

    bindEvents() {
        try {
            // Refresh button
            const refreshBtn = document.getElementById('refresh-btn');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => {
                    this.scanForVideos();
                });
            }
        } catch (error) {
            console.error('Error binding events:', error);
        }
    }

    async scanForVideos() {
        this.showLoading();
        
        try {
            // Get current active tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab) {
                throw new Error('Không thể truy cập tab hiện tại');
            }

            // Check if tab URL is valid for content script injection
            if (!this.isValidTabUrl(tab.url)) {
                this.showSpecialPageError(tab.url);
                return;
            }

            try {
                // Try to inject content script if not already present
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });
            } catch (injectionError) {
                // Content script might already be injected, continue
                console.log('Content script injection skipped:', injectionError.message);
            }

            // Wait a bit for content script to initialize
            await new Promise(resolve => setTimeout(resolve, 200));

            // Send message to content script to find videos with retry
            const response = await this.sendMessageWithRetry(tab.id, {
                action: 'findVideos'
            }, 3);

            if (response && response.videos) {
                this.videos = response.videos;
                this.displayVideos();
            } else {
                this.showNoVideos();
            }
        } catch (error) {
            console.error('Error scanning for videos:', error);
            this.showError(error.message);
        }
    }

    async sendMessageWithRetry(tabId, message, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await chrome.tabs.sendMessage(tabId, message);
                return response;
            } catch (error) {
                console.log(`Message attempt ${attempt} failed:`, error.message);
                
                if (attempt === maxRetries) {
                    throw new Error(`Không thể kết nối với trang web sau ${maxRetries} lần thử. Vui lòng refresh trang và thử lại.`);
                }
                
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 300 * attempt));
            }
        }
    }

    isValidTabUrl(url) {
        if (!url) return false;
        
        // Check for invalid URLs where content scripts can't run
        const invalidPrefixes = [
            'chrome://',
            'chrome-extension://',
            'moz-extension://',
            'edge://',
            'about:',
            'data:',
            'file://'
        ];
        
        return !invalidPrefixes.some(prefix => url.startsWith(prefix));
    }

    showLoading() {
        this.hideAllSections();
        const loadingElement = document.getElementById('loading');
        if (loadingElement) {
            loadingElement.style.display = 'block';
        }
    }

    showNoVideos() {
        this.hideAllSections();
        const noVideosElement = document.getElementById('no-videos');
        if (noVideosElement) {
            noVideosElement.style.display = 'block';
        }
    }

    showError(message) {
        this.hideAllSections();
        const errorSection = document.getElementById('error');
        const errorDetails = document.getElementById('error-details');
        
        if (errorDetails) {
            errorDetails.textContent = message;
        }
        if (errorSection) {
            errorSection.style.display = 'block';
        }
    }

    showSpecialPageError(url) {
        this.hideAllSections();
        
        // Determine the type of special page
        let pageType = 'trang đặc biệt';
        let suggestion = 'Hãy mở một trang web bình thường';
        
        if (url.startsWith('chrome://')) {
            pageType = 'trang cài đặt Chrome';
            suggestion = 'Hãy mở YouTube, Facebook hoặc trang web khác';
        } else if (url.startsWith('chrome-extension://')) {
            pageType = 'trang extension';
            suggestion = 'Hãy mở một trang web để quét video';
        } else if (url.startsWith('edge://')) {
            pageType = 'trang cài đặt Edge';
            suggestion = 'Hãy mở YouTube, Facebook hoặc trang web khác';
        } else if (url.startsWith('about:')) {
            pageType = 'trang about';
            suggestion = 'Hãy mở một trang web bình thường';
        } else if (url.startsWith('file://')) {
            pageType = 'file cục bộ';
            suggestion = 'Hãy mở trang web online để quét video';
        }

        const errorSection = document.getElementById('error');
        const errorDetails = document.getElementById('error-details');
        
        if (errorDetails) {
            errorDetails.innerHTML = `
                <strong>Không thể quét video trên ${pageType}</strong><br>
                <br>
                ${suggestion}<br>
                <br>
                <em>Extension chỉ hoạt động trên:</em><br>
                • YouTube, Facebook, Twitter<br>
                • Các trang web có video<br>
                • Trang web HTTP/HTTPS
            `;
        }
        if (errorSection) {
            errorSection.style.display = 'block';
        }
    }

    hideAllSections() {
        const sections = ['loading', 'no-videos', 'videos-list', 'error'];
        sections.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.style.display = 'none';
            }
        });
    }

    displayVideos() {
        if (this.videos.length === 0) {
            this.showNoVideos();
            return;
        }

        this.hideAllSections();
        document.getElementById('videos-list').style.display = 'block';
        
        const videoList = document.getElementById('video-items');
        videoList.innerHTML = '';

        this.videos.forEach((video, index) => {
            const listItem = this.createVideoItem(video, index);
            videoList.appendChild(listItem);
        });
    }

    createVideoItem(video, index) {
        const li = document.createElement('li');
        li.className = 'video-item';
        
        const title = video.title || this.extractVideoTitle(video.url);
        const shortUrl = this.shortenUrl(video.url);
        const platform = this.getPlatformDisplayName(video.type);
        const format = video.format || 'Unknown';
        
        // Check if this is a blob URL or non-downloadable video
        const isBlob = video.url && video.url.startsWith('blob:');
        const isNonDownloadable = video.downloadable === false;
        
        let warningHtml = '';
        let buttonHtml = '';
        
        if (isBlob || isNonDownloadable) {
            warningHtml = `
                <div class="video-warning">
                    <span class="warning-icon">⚠️</span>
                    <span class="warning-text">${video.reason || 'Video này không thể tải xuống trực tiếp'}</span>
                </div>
                ${video.alternative ? `<div class="video-alternative">💡 ${video.alternative}</div>` : ''}
            `;
            buttonHtml = `
                <button class="btn secondary info-btn" data-index="${index}">
                    Xem hướng dẫn
                </button>
            `;
        } else {
            buttonHtml = `
                <button class="btn primary download-btn" data-index="${index}">
                    Tải xuống
                </button>
            `;
        }

        li.innerHTML = `
            <div class="video-info">
                <div class="video-title">${title}</div>
                <div class="video-meta">
                    <span class="platform-badge ${video.type}">${platform}</span>
                    <span class="format-badge">${format.toUpperCase()}</span>
                    <span class="size-badge">${video.size || 'Unknown'}</span>
                </div>
                <div class="video-url">${shortUrl}</div>
                ${warningHtml}
            </div>
            ${buttonHtml}
        `;

        // Add event listeners
        const downloadBtn = li.querySelector('.download-btn');
        const infoBtn = li.querySelector('.info-btn');
        
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                this.downloadVideo(video, downloadBtn);
            });
        }
        
        if (infoBtn) {
            infoBtn.addEventListener('click', () => {
                this.showVideoInfo(video);
            });
        }

        return li;
    }

    showVideoInfo(video) {
        const isBlob = video.url && video.url.startsWith('blob:');
        let message = '';
        
        if (isBlob) {
            message = `
🔍 Thông tin Video:
• Loại: Blob URL (${video.format || 'Unknown'})
• Platform: ${this.getPlatformDisplayName(video.type)}

⚠️ Lý do không thể tải xuống:
${video.reason || 'Blob URLs không thể tải xuống trực tiếp từ extension'}

💡 Các cách thay thế:
1. Right-click trên video → "Save video as..."
2. Sử dụng browser's built-in download feature
3. Sử dụng screen recording tools
4. Sử dụng các công cụ chuyên dụng như yt-dlp, 4K Video Downloader

🎯 Lưu ý:
• Blob URLs chỉ tồn tại trong phiên làm việc hiện tại
• Một số platform bảo vệ content bằng cách sử dụng blob URLs
• Extension không thể truy cập blob URLs từ context khác
            `;
        } else {
            message = `
🔍 Thông tin Video:
• URL: ${video.url}
• Loại: ${video.type}
• Format: ${video.format || 'Unknown'}
• Kích thước: ${video.size || 'Unknown'}

${video.reason ? `⚠️ ${video.reason}` : ''}
${video.alternative ? `💡 ${video.alternative}` : ''}
            `;
        }
        
        alert(message);
    }

    getPlatformDisplayName(type) {
        const platformNames = {
            'tiktok': 'TikTok',
            'facebook': 'Facebook',
            'youtube': 'YouTube',
            'instagram': 'Instagram',
            'twitter': 'Twitter/X',
            'twitch': 'Twitch',
            'tiktok_blob': 'TikTok',
            'facebook_blob': 'Facebook',
            'youtube_blob': 'YouTube',
            'instagram_blob': 'Instagram',
            'twitter_blob': 'Twitter/X',
            'twitch_blob': 'Twitch',
            'direct': 'Direct',
            'source': 'HTML5'
        };
        
        return platformNames[type] || 'Generic';
    }

    extractVideoTitle(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const filename = pathname.split('/').pop();
            
            if (filename && filename.includes('.')) {
                return filename;
            }
            
            return `video_${Date.now()}.mp4`;
        } catch {
            return `video_${Date.now()}.mp4`;
        }
    }

    shortenUrl(url) {
        if (url.length <= 50) return url;
        return url.substring(0, 30) + '...' + url.substring(url.length - 17);
    }

    async downloadVideo(video, button) {
        const originalText = button.textContent;
        button.textContent = 'Đang tải...';
        button.disabled = true;

        try {
            // Check if it's a streaming video
            const isStreaming = video.format === 'HLS' || video.format === 'DASH' || 
                               video.url.includes('.m3u8') || video.url.includes('.mpd');
            
            if (isStreaming) {
                // Handle streaming video
                await chrome.runtime.sendMessage({
                    action: 'downloadStreaming',
                    video: video
                });
                
                button.textContent = 'Đã phát hiện stream!';
                button.className = 'btn warning download-btn';
                
                // Show info message
                setTimeout(() => {
                    button.textContent = 'Tệp playlist đã tải';
                    button.className = 'btn info download-btn';
                }, 1000);
            } else {
                // Handle regular video
                await chrome.runtime.sendMessage({
                    action: 'downloadVideo',
                    url: video.url,
                    filename: video.title || this.extractVideoTitle(video.url)
                });

                button.textContent = 'Đã tải!';
                button.className = 'btn success download-btn';
            }
            
            // Reset button after 3 seconds
            setTimeout(() => {
                button.textContent = originalText;
                button.className = 'btn primary download-btn';
                button.disabled = false;
            }, 3000);

        } catch (error) {
            console.error('Download error:', error);
            button.textContent = 'Lỗi!';
            button.className = 'btn error download-btn';
            
            // Reset button after 2 seconds
            setTimeout(() => {
                button.textContent = originalText;
                button.className = 'btn primary download-btn';
                button.disabled = false;
            }, 2000);
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    const helper = new VideoDownloadHelper();
    await helper.init();
});