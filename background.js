// Video DownloadHelper - Background Script

class VideoDownloadHelper {
    constructor() {
        this.streamingUrls = new Map();
        this.init();
    }

    init() {
        // Listen for messages from popup
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true; // Async response
        });

        // Monitor network requests for streaming URLs
        this.setupNetworkMonitoring();

        // Listen for download events
        chrome.downloads.onChanged.addListener((downloadDelta) => {
            this.handleDownloadChange(downloadDelta);
        });

        // Extension installation/update
        chrome.runtime.onInstalled.addListener((details) => {
            this.handleInstallation(details);
        });
    }

    async handleMessage(request, sender, sendResponse) {
        try {
            if (request.action === 'downloadVideo') {
                const result = await this.downloadVideo(request.url, request.filename);
                sendResponse({ success: true, downloadId: result });
            } else if (request.action === 'downloadStreaming') {
                const result = await this.downloadStreamingVideo(request.video);
                sendResponse({ success: true, result: result });
            }
        } catch (error) {
            console.error('Message handling error:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    setupNetworkMonitoring() {
        // Monitor web requests for streaming content
        if (chrome.webRequest) {
            chrome.webRequest.onBeforeRequest.addListener(
                (details) => {
                    if (this.isStreamingUrl(details.url)) {
                        console.log('Detected streaming request:', details.url);
                        this.storeStreamingUrl(details.url, details.tabId);
                    }
                },
                { urls: ["<all_urls>"] },
                ["requestBody"]
            );
        }
    }

    isStreamingUrl(url) {
        if (!url || typeof url !== 'string') return false;
        
        // Check for HLS (.m3u8)
        if (url.includes('.m3u8') || url.includes('m3u8')) {
            return true;
        }
        
        // Check for DASH (.mpd)
        if (url.includes('.mpd') || url.includes('mpd')) {
            return true;
        }
        
        // Check for TS segments
        if (url.includes('.ts') && (url.includes('segment') || url.includes('chunk'))) {
            return true;
        }
        
        return false;
    }

    async storeStreamingUrl(url, tabId) {
        try {
            if (!this.streamingUrls.has(tabId)) {
                this.streamingUrls.set(tabId, new Set());
            }
            this.streamingUrls.get(tabId).add(url);
            
            // Clean up old entries (keep only last 100 per tab)
            const urls = this.streamingUrls.get(tabId);
            if (urls.size > 100) {
                const urlArray = Array.from(urls);
                this.streamingUrls.set(tabId, new Set(urlArray.slice(-100)));
            }
        } catch (error) {
            console.error('Error storing streaming URL:', error);
        }
    }

    async downloadVideo(url, filename) {
        try {
            console.log('Starting download:', { url, filename });
            
            // Validate URL
            if (!this.isValidUrl(url)) {
                throw new Error('URL không hợp lệ');
            }

            // Handle blob URLs specially
            if (this.isBlobUrl(url)) {
                console.log('Detected blob URL - cannot download directly');
                this.showNotification('Blob URL không hỗ trợ', {
                    message: `Blob URLs không thể tải xuống trực tiếp. Hãy thử right-click và "Save video as..." trên video.`,
                    type: 'basic',
                    iconUrl: 'icons/icon.png'
                });
                throw new Error('Blob URLs không thể tải xuống trực tiếp');
            }
            
            // Handle social media URLs
            if (this.isSocialMediaUrl(url)) {
                console.log('Detected social media URL');
                this.showNotification('Social Media Video', {
                    message: `Video từ social media thường được bảo vệ. Hãy thử sử dụng các công cụ chuyên dụng như yt-dlp hoặc 4K Video Downloader.`,
                    type: 'basic',
                    iconUrl: 'icons/icon.png'
                });
                // Still try to download, but warn user
            }

            // Check URL accessibility first
            const accessCheck = await this.checkUrlAccessibility(url);
            console.log('URL accessibility check:', accessCheck);
            
            if (!accessCheck.accessible) {
                this.showNotification('URL không khả dụng', {
                    message: `Không thể truy cập URL: ${accessCheck.error}`,
                    type: 'basic',
                    iconUrl: 'icons/icon.png'
                });
                throw new Error(`URL không khả dụng: ${accessCheck.error}`);
            }

            // Sanitize filename
            const sanitizedFilename = this.sanitizeFilename(filename);
            console.log('Sanitized filename:', sanitizedFilename);
            
            // Start download
            const downloadId = await chrome.downloads.download({
                url: url,
                filename: sanitizedFilename,
                conflictAction: 'uniquify',
                saveAs: false
            });

            console.log('Download started with ID:', downloadId);
            
            // Store download info
            await this.storeDownloadInfo(downloadId, {
                url: url,
                filename: sanitizedFilename,
                startTime: Date.now()
            });

            return downloadId;
        } catch (error) {
            console.error('Error starting download:', error);
            throw error;
        }
    }

    async downloadStreamingVideo(video) {
        try {
            const format = video.format || this.detectStreamingFormat(video.url);
            
            if (format === 'HLS') {
                return await this.downloadHLS(video);
            } else if (format === 'DASH') {
                return await this.downloadDASH(video);
            } else {
                return await this.downloadDirect(video);
            }
        } catch (error) {
            console.error('Streaming download error:', error);
            throw error;
        }
    }

    detectStreamingFormat(url) {
        if (url.includes('.m3u8')) return 'HLS';
        if (url.includes('.mpd')) return 'DASH';
        return 'DIRECT';
    }

    async downloadHLS(video) {
        try {
            // Fetch M3U8 playlist
            const response = await fetch(video.url);
            const playlistText = await response.text();
            
            // Parse playlist to get segments
            const segments = this.parseM3U8(playlistText, video.url);
            
            // Download playlist file for user
            await this.downloadPlaylistFile(video, playlistText, 'm3u8');
            
            this.showStreamingNotification(video, 'HLS', segments.length);
            
            return { 
                success: true, 
                format: 'HLS', 
                segments: segments.length,
                message: 'HLS playlist downloaded'
            };
        } catch (error) {
            console.error('HLS download error:', error);
            throw error;
        }
    }

    async downloadDASH(video) {
        try {
            // Fetch DASH manifest
            const response = await fetch(video.url);
            const manifestText = await response.text();
            
            // Download manifest file for user
            await this.downloadPlaylistFile(video, manifestText, 'mpd');
            
            this.showStreamingNotification(video, 'DASH', 0);
            
            return { 
                success: true, 
                format: 'DASH', 
                message: 'DASH manifest downloaded'
            };
        } catch (error) {
            console.error('DASH download error:', error);
            throw error;
        }
    }

    async downloadDirect(video) {
        try {
            return await this.downloadVideo(video.url, video.title || 'streaming_video');
        } catch (error) {
            console.error('Direct download error:', error);
            throw error;
        }
    }

    parseM3U8(playlistText, baseUrl) {
        const lines = playlistText.split('\n');
        const segments = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (line && !line.startsWith('#')) {
                // This is a segment URL
                let segmentUrl = line;
                
                // Handle relative URLs
                if (!segmentUrl.startsWith('http')) {
                    const baseUrlObj = new URL(baseUrl);
                    if (segmentUrl.startsWith('/')) {
                        segmentUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${segmentUrl}`;
                    } else {
                        const basePath = baseUrlObj.pathname.substring(0, baseUrlObj.pathname.lastIndexOf('/') + 1);
                        segmentUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${basePath}${segmentUrl}`;
                    }
                }
                
                segments.push(segmentUrl);
            }
        }
        
        return segments;
    }

    async downloadPlaylistFile(video, content, extension) {
        try {
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const filename = this.generateFilename(video, extension);
            
            const downloadId = await chrome.downloads.download({
                url: url,
                filename: filename,
                conflictAction: 'uniquify',
                saveAs: false
            });
            
            // Clean up blob URL after download
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            
            return downloadId;
        } catch (error) {
            console.error('Playlist download error:', error);
            throw error;
        }
    }

    generateFilename(video, extension = 'mp4') {
        let filename = video.title || 'video';
        
        // Clean filename
        filename = this.sanitizeFilename(filename);
        
        // Remove existing extension
        if (filename.includes('.')) {
            filename = filename.substring(0, filename.lastIndexOf('.'));
        }
        
        // Add new extension
        return `${filename}.${extension}`;
    }

    sanitizeFilename(filename) {
        if (!filename || typeof filename !== 'string') {
            filename = `video_${Date.now()}`;
        }
        
        return filename
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .trim()
            .substring(0, 100);
    }

    showStreamingNotification(video, format, segmentCount) {
        const message = segmentCount > 0 
            ? `${format} stream detected with ${segmentCount} segments. Downloading playlist file.`
            : `${format} stream detected. Downloading manifest file.`;
            
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon.png',
            title: 'Video DownloadHelper',
            message: message
        });
    }

    isValidUrl(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    // Check if URL is a blob URL
    isBlobUrl(url) {
        return url.startsWith('blob:');
    }

    // Check if URL is from a social media platform
    isSocialMediaUrl(url) {
        const socialDomains = ['facebook.com', 'youtube.com', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com'];
        try {
            const urlObj = new URL(url);
            return socialDomains.some(domain => urlObj.hostname.includes(domain));
        } catch {
            return false;
        }
    }

    // Check if URL is accessible
    async checkUrlAccessibility(url) {
        try {
            const response = await fetch(url, { 
                method: 'HEAD',
                mode: 'no-cors' // Avoid CORS issues for checking
            });
            return {
                accessible: true,
                status: response.status,
                headers: response.headers
            };
        } catch (error) {
            console.warn('URL accessibility check failed:', error.message);
            return {
                accessible: false,
                error: error.message
            };
        }
    }

    async storeDownloadInfo(downloadId, info) {
        try {
            await chrome.storage.local.set({ [`download_${downloadId}`]: info });
        } catch (error) {
            console.error('Error storing download info:', error);
        }
    }

    async getDownloadInfo(downloadId) {
        try {
            const result = await chrome.storage.local.get([`download_${downloadId}`]);
            return result[`download_${downloadId}`];
        } catch (error) {
            console.error('Error getting download info:', error);
            return null;
        }
    }

    async handleDownloadChange(downloadDelta) {
        if (downloadDelta.state && downloadDelta.state.current) {
            const downloadId = downloadDelta.id;
            const state = downloadDelta.state.current;

            console.log(`Download ${downloadId} state changed to: ${state}`);

            const downloadInfo = await this.getDownloadInfo(downloadId);

            if (state === 'complete') {
                console.log(`Download completed: ${downloadInfo?.filename || downloadId}`);
                
                this.showNotification('Tải xuống hoàn tất', {
                    message: `Video đã được tải xuống: ${downloadInfo?.filename || 'video'}`,
                    type: 'basic',
                    iconUrl: 'icons/icon.png'
                });
                
                await this.cleanupDownloadInfo(downloadId);
                
            } else if (state === 'interrupted') {
                // Get more detailed error information
                const downloadItem = await chrome.downloads.search({id: downloadId});
                const errorReason = downloadItem[0]?.error || 'Unknown error';
                
                console.error(`Download interrupted: ${downloadId}`);
                console.error('Error reason:', errorReason);
                console.error('Download URL:', downloadInfo?.url);
                console.error('Filename:', downloadInfo?.filename);
                console.error('Download item details:', JSON.stringify(downloadItem[0], null, 2));
                
                // Try alternative download method for certain errors
                if (errorReason === 'NETWORK_FAILED' || errorReason === 'SERVER_FORBIDDEN') {
                    console.log('Attempting alternative download method...');
                    this.showNotification('Thử phương pháp khác', {
                        message: `Đang thử tải xuống bằng cách khác: ${downloadInfo?.filename || 'video'}`,
                        type: 'basic',
                        iconUrl: 'icons/icon.png'
                    });
                    
                    // Try to open URL in new tab as fallback
                    try {
                        await chrome.tabs.create({ url: downloadInfo?.url, active: false });
                    } catch (tabError) {
                        console.error('Failed to open in new tab:', tabError);
                    }
                } else {
                    this.showNotification('Lỗi tải xuống', {
                        message: `Không thể tải xuống video: ${downloadInfo?.filename || 'video'}\nLỗi: ${errorReason}`,
                        type: 'basic',
                        iconUrl: 'icons/icon.png'
                    });
                }
                
                await this.cleanupDownloadInfo(downloadId);
            }
        }
    }

    async cleanupDownloadInfo(downloadId) {
        try {
            await chrome.storage.local.remove([`download_${downloadId}`]);
        } catch (error) {
            console.error('Error cleaning up download info:', error);
        }
    }

    showNotification(title, options) {
        try {
            chrome.notifications.create({
                type: options.type || 'basic',
                iconUrl: options.iconUrl || 'icons/icon.png',
                title: title,
                message: options.message || ''
            });
        } catch (error) {
            console.error('Error showing notification:', error);
        }
    }

    handleInstallation(details) {
        if (details.reason === 'install') {
            console.log('Video DownloadHelper installed');
            
            // Set default settings
            chrome.storage.local.set({
                settings: {
                    autoScan: true,
                    showNotifications: true,
                    defaultDownloadPath: '',
                    version: chrome.runtime.getManifest().version
                }
            });
        } else if (details.reason === 'update') {
            console.log('Video DownloadHelper updated');
            
            // Handle update logic
            this.handleUpdate(details.previousVersion);
        }
    }

    async handleUpdate(previousVersion) {
        try {
            // Update settings if needed
            const result = await chrome.storage.local.get(['settings']);
            const settings = result.settings || {};
            
            settings.version = chrome.runtime.getManifest().version;
            
            await chrome.storage.local.set({ settings });
            
            console.log(`Updated from version ${previousVersion} to ${settings.version}`);
        } catch (error) {
            console.error('Error handling update:', error);
        }
    }
}

// Initialize the background service
new VideoDownloadHelper();