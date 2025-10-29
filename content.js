// Video DownloadHelper - Content Script

// Prevent multiple instances
if (window.videoDetectorInstance) {
    console.log('VideoDetector already exists, skipping initialization');
} else {
    class VideoDetector {
        constructor() {
            this.videos = [];
            this.streamingUrls = new Set(); // Track streaming URLs
            this.init();
        }

        init() {
            // Listen for messages from popup
            chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
                if (request.action === 'findVideos') {
                    this.findVideos()
                        .then(videos => {
                            sendResponse({ videos: videos });
                        })
                        .catch(error => {
                            console.error('Error finding videos:', error);
                            sendResponse({ videos: [], error: error.message });
                        });
                    
                    // Return true to indicate we'll send response asynchronously
                    return true;
                }
            });

            // Monitor network requests for streaming URLs
            this.monitorNetworkRequests();
            
            // Auto-scan when content script loads
            this.findVideos();
        }

        monitorNetworkRequests() {
            // Override XMLHttpRequest to catch streaming URLs
            const originalOpen = XMLHttpRequest.prototype.open;
            const self = this;
            
            XMLHttpRequest.prototype.open = function(method, url, ...args) {
                if (self.isStreamingUrl(url)) {
                    console.log('Detected streaming URL:', url);
                    self.streamingUrls.add(url);
                }
                return originalOpen.apply(this, [method, url, ...args]);
            };

            // Override fetch to catch streaming URLs
            const originalFetch = window.fetch;
            window.fetch = function(url, ...args) {
                if (typeof url === 'string' && self.isStreamingUrl(url)) {
                    console.log('Detected streaming URL via fetch:', url);
                    self.streamingUrls.add(url);
                } else if (url instanceof Request && self.isStreamingUrl(url.url)) {
                    console.log('Detected streaming URL via fetch Request:', url.url);
                    self.streamingUrls.add(url.url);
                }
                return originalFetch.apply(this, [url, ...args]);
            };
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
            
            // Check for common streaming patterns
            const streamingPatterns = [
                /\/hls\//i,
                /\/dash\//i,
                /\/stream\//i,
                /\/manifest\//i,
                /playlist\.m3u8/i,
                /master\.m3u8/i,
                /index\.m3u8/i,
                /\.ts$/i, // Transport Stream segments
                /segment-\d+/i
            ];
            
            return streamingPatterns.some(pattern => pattern.test(url));
        }

        isBlobUrl(url) {
            return url && url.startsWith('blob:');
        }

        isSocialMediaUrl(url) {
            if (!url) return false;
            const socialDomains = ['facebook.com', 'youtube.com', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com'];
            try {
                const urlObj = new URL(url);
                return socialDomains.some(domain => urlObj.hostname.includes(domain));
            } catch {
                return false;
            }
        }

        getStreamingFormat(url) {
            if (url.includes('.m3u8') || url.includes('m3u8')) {
                return 'HLS';
            }
            if (url.includes('.mpd') || url.includes('mpd')) {
                return 'DASH';
            }
            if (url.includes('.ts')) {
                return 'TS';
            }
            return 'Stream';
        }

    async findVideos() {
        try {
            this.videos = [];
            
            // Detect current platform
            const platform = this.detectPlatform();
            console.log('Detected platform:', platform);
            
            // Find all video elements with direct src
            await this.findDirectVideoElements();
            
            // Find videos in source elements
            await this.findSourceElements();
            
            // Find platform-specific videos
            await this.findPlatformSpecificVideos(platform);
            
            // Find streaming URLs
            await this.findStreamingVideos(platform);
            
            // Remove duplicates
            this.videos = this.removeDuplicates(this.videos);
            
            // Filter valid videos
            this.videos = this.videos.filter(video => this.isValidVideo(video));
            
            console.log(`Found ${this.videos.length} videos:`, this.videos);
            
            return this.videos;
        } catch (error) {
            console.error('Error in findVideos:', error);
            return [];
        }
    }

    async findStreamingVideos(platform) {
        // Add detected streaming URLs to videos list
        this.streamingUrls.forEach(url => {
            const format = this.getStreamingFormat(url);
            this.videos.push({
                url: url,
                type: 'streaming',
                platform: platform,
                format: format,
                size: 'Unknown',
                title: this.extractTitleFromStreamingUrl(url, platform) || `${platform} ${format} Stream`,
                isStreaming: true
            });
        });

        // Look for streaming URLs in page content
        await this.scanPageForStreamingUrls(platform);
    }

    async scanPageForStreamingUrls(platform) {
        // Scan script tags for streaming URLs
        const scripts = document.querySelectorAll('script');
        scripts.forEach(script => {
            if (script.textContent) {
                const streamingUrls = this.extractStreamingUrlsFromText(script.textContent);
                streamingUrls.forEach(url => {
                    const format = this.getStreamingFormat(url);
                    this.videos.push({
                        url: url,
                        type: 'streaming',
                        platform: platform,
                        format: format,
                        size: 'Unknown',
                        title: this.extractTitleFromStreamingUrl(url, platform) || `${platform} ${format} Stream`,
                        isStreaming: true
                    });
                });
            }
        });

        // Platform-specific streaming detection
        if (platform === 'youtube') {
            await this.findYouTubeStreamingUrls();
        } else if (platform === 'facebook') {
            await this.findFacebookStreamingUrls();
        } else if (platform === 'tiktok') {
            await this.findTikTokStreamingUrls();
        }
    }

    extractStreamingUrlsFromText(text) {
        const urls = [];
        
        // Regex patterns for streaming URLs
        const patterns = [
            /https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi,
            /https?:\/\/[^\s"']+\.mpd[^\s"']*/gi,
            /https?:\/\/[^\s"']+\/hls\/[^\s"']*/gi,
            /https?:\/\/[^\s"']+\/dash\/[^\s"']*/gi,
            /"(https?:\/\/[^"]*(?:m3u8|mpd)[^"]*)"/gi,
            /'(https?:\/\/[^']*(?:m3u8|mpd)[^']*)'/gi
        ];
        
        patterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const url = match[1] || match[0];
                if (url && this.isStreamingUrl(url)) {
                    urls.push(url.replace(/['"]/g, ''));
                }
            }
        });
        
        return [...new Set(urls)]; // Remove duplicates
    }

    extractTitleFromStreamingUrl(url, platform) {
        // Try to extract meaningful title from streaming URL
        try {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/').filter(part => part);
            
            // Look for meaningful parts in the path
            for (let i = pathParts.length - 1; i >= 0; i--) {
                const part = pathParts[i];
                if (part && !part.match(/\.(m3u8|mpd|ts)$/i) && part.length > 3) {
                    return this.sanitizeTitle(part.replace(/[-_]/g, ' '));
                }
            }
            
            // Fallback to platform-specific title
            return `${platform} Stream`;
        } catch (error) {
            return `${platform} Stream`;
        }
    }

    async findYouTubeStreamingUrls() {
        // Look for YouTube player data
        const scripts = document.querySelectorAll('script');
        scripts.forEach(script => {
            if (script.textContent && script.textContent.includes('ytInitialPlayerResponse')) {
                try {
                    const playerDataMatch = script.textContent.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
                    if (playerDataMatch) {
                        const playerData = JSON.parse(playerDataMatch[1]);
                        if (playerData.streamingData) {
                            this.extractYouTubeStreamingData(playerData.streamingData);
                        }
                    }
                } catch (error) {
                    console.log('Error parsing YouTube player data:', error);
                }
            }
        });
    }

    extractYouTubeStreamingData(streamingData) {
        // Extract HLS and DASH URLs from YouTube streaming data
        if (streamingData.hlsManifestUrl) {
            this.videos.push({
                url: streamingData.hlsManifestUrl,
                type: 'streaming',
                platform: 'youtube',
                format: 'HLS',
                size: 'Unknown',
                title: document.title.replace(' - YouTube', '') || 'YouTube HLS Stream',
                isStreaming: true
            });
        }
        
        if (streamingData.dashManifestUrl) {
            this.videos.push({
                url: streamingData.dashManifestUrl,
                type: 'streaming',
                platform: 'youtube',
                format: 'DASH',
                size: 'Unknown',
                title: document.title.replace(' - YouTube', '') || 'YouTube DASH Stream',
                isStreaming: true
            });
        }
    }

    async findFacebookStreamingUrls() {
        // Look for Facebook video data
        const scripts = document.querySelectorAll('script');
        scripts.forEach(script => {
            if (script.textContent && (script.textContent.includes('hd_src') || script.textContent.includes('sd_src'))) {
                const streamingUrls = this.extractStreamingUrlsFromText(script.textContent);
                streamingUrls.forEach(url => {
                    const format = this.getStreamingFormat(url);
                    this.videos.push({
                        url: url,
                        type: 'streaming',
                        platform: 'facebook',
                        format: format,
                        size: 'Unknown',
                        title: this.extractFacebookTitle() || 'Facebook Stream',
                        isStreaming: true
                    });
                });
            }
        });
    }

    async findTikTokStreamingUrls() {
        // Look for TikTok video data
        const scripts = document.querySelectorAll('script');
        scripts.forEach(script => {
            if (script.textContent && script.textContent.includes('playAddr')) {
                const streamingUrls = this.extractStreamingUrlsFromText(script.textContent);
                streamingUrls.forEach(url => {
                    const format = this.getStreamingFormat(url);
                    this.videos.push({
                        url: url,
                        type: 'streaming',
                        platform: 'tiktok',
                        format: format,
                        size: 'Unknown',
                        title: this.extractTikTokTitle() || 'TikTok Stream',
                        isStreaming: true
                    });
                });
            }
        });
    }

    async findDirectVideoElements() {
        // Find video elements with src attribute
        const videoElements = document.querySelectorAll('video[src]');
        
        videoElements.forEach(video => {
            if (video.src && this.isValidVideoUrl(video.src)) {
                this.videos.push({
                    src: video.src,
                    type: 'direct',
                    element: video,
                    title: this.extractVideoTitle(video),
                    duration: video.duration || 0,
                    currentTime: video.currentTime || 0
                });
            }
        });
    }

    async findSourceElements() {
        // Find video elements with source children
        const videoElements = document.querySelectorAll('video');
        
        videoElements.forEach(video => {
            const sources = video.querySelectorAll('source[src]');
            
            sources.forEach(source => {
                if (source.src && this.isValidVideoUrl(source.src)) {
                    this.videos.push({
                        src: source.src,
                        type: 'source',
                        element: video,
                        sourceElement: source,
                        title: this.extractVideoTitle(video, source),
                        duration: video.duration || 0,
                        currentTime: video.currentTime || 0,
                        mimeType: source.type || ''
                    });
                }
            });
        });
    }

    detectPlatform() {
        const hostname = window.location.hostname.toLowerCase();
        const url = window.location.href.toLowerCase();
        
        if (hostname.includes('tiktok.com')) {
            return 'tiktok';
        } else if (hostname.includes('facebook.com') || hostname.includes('fb.com')) {
            return 'facebook';
        } else if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
            return 'youtube';
        } else if (hostname.includes('instagram.com')) {
            return 'instagram';
        } else if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
            return 'twitter';
        } else if (hostname.includes('twitch.tv')) {
            return 'twitch';
        }
        
        return 'generic';
    }

    async findPlatformSpecificVideos(platform) {
        switch (platform) {
            case 'tiktok':
                await this.findTikTokVideos();
                break;
            case 'facebook':
                await this.findFacebookVideos();
                break;
            case 'youtube':
                await this.findYouTubeVideos();
                break;
            case 'instagram':
                await this.findInstagramVideos();
                break;
            case 'twitter':
                await this.findTwitterVideos();
                break;
            case 'twitch':
                await this.findTwitchVideos();
                break;
            default:
                // Generic platform, already handled by standard methods
                break;
        }
    }

    isValidVideoUrl(url) {
        try {
            const urlObj = new URL(url);
            
            // Must be http or https
            if (!['http:', 'https:'].includes(urlObj.protocol)) {
                return false;
            }
            
            // Skip blob URLs for now (MVP doesn't support them)
            if (url.startsWith('blob:')) {
                return false;
            }
            
            // Skip data URLs
            if (url.startsWith('data:')) {
                return false;
            }
            
            // Check for common video file extensions
            const videoExtensions = ['.mp4', '.webm', '.ogg', '.avi', '.mov', '.wmv', '.flv', '.mkv'];
            const hasVideoExtension = videoExtensions.some(ext => 
                url.toLowerCase().includes(ext)
            );
            
            // Check for video MIME types in URL (some streaming URLs)
            const videoMimePatterns = ['video/', 'mp4', 'webm', 'ogg'];
            const hasVideoMime = videoMimePatterns.some(pattern => 
                url.toLowerCase().includes(pattern)
            );
            
            return hasVideoExtension || hasVideoMime;
        } catch {
            return false;
        }
    }

    getVideoFormat(url) {
        if (!url) return 'Unknown';
        
        const urlLower = url.toLowerCase();
        
        if (urlLower.includes('.mp4')) return 'MP4';
        if (urlLower.includes('.webm')) return 'WebM';
        if (urlLower.includes('.ogg')) return 'OGG';
        if (urlLower.includes('.avi')) return 'AVI';
        if (urlLower.includes('.mov')) return 'MOV';
        if (urlLower.includes('.wmv')) return 'WMV';
        if (urlLower.includes('.flv')) return 'FLV';
        if (urlLower.includes('.mkv')) return 'MKV';
        if (urlLower.includes('.m3u8')) return 'HLS';
        if (urlLower.includes('.mpd')) return 'DASH';
        if (urlLower.includes('.ts')) return 'TS';
        if (urlLower.startsWith('blob:')) return 'Blob';
        
        return 'Video';
    }

    removeDuplicates(videos) {
        const seen = new Set();
        return videos.filter(video => {
            const key = video.url || video.src;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    isValidVideo(video) {
        // Additional validation for streaming videos
        if (video.isStreaming) {
            return video.url && video.url.length > 10;
        }
        
        // Original validation for regular videos
        const videoUrl = video.url || video.src;
        if (!videoUrl || videoUrl.length < 10) {
            return false;
        }
        
        // Skip very short URLs (likely not real videos)
        if (videoUrl.length < 20) {
            return false;
        }
        
        return true;
    }

    extractVideoTitle(videoElement, sourceElement = null) {
        // Try to get title from various sources
        let title = '';
        
        // 1. Try video element attributes
        if (videoElement.title) {
            title = videoElement.title;
        } else if (videoElement.getAttribute('data-title')) {
            title = videoElement.getAttribute('data-title');
        } else if (videoElement.getAttribute('aria-label')) {
            title = videoElement.getAttribute('aria-label');
        }
        
        // 2. Try source element attributes
        if (!title && sourceElement) {
            if (sourceElement.title) {
                title = sourceElement.title;
            } else if (sourceElement.getAttribute('data-title')) {
                title = sourceElement.getAttribute('data-title');
            }
        }
        
        // 3. Try nearby text content
        if (!title) {
            title = this.findNearbyTitle(videoElement);
        }
        
        // 4. Extract from URL
        if (!title) {
            title = this.extractTitleFromUrl(videoElement.src || sourceElement?.src);
        }
        
        // 5. Fallback
        if (!title) {
            title = `Video ${Date.now()}`;
        }
        
        return this.sanitizeTitle(title);
    }

    findNearbyTitle(videoElement) {
        // Look for title in parent elements
        let parent = videoElement.parentElement;
        let depth = 0;
        
        while (parent && depth < 3) {
            // Check for title attributes
            if (parent.title) {
                return parent.title;
            }
            
            // Check for heading elements
            const heading = parent.querySelector('h1, h2, h3, h4, h5, h6');
            if (heading && heading.textContent.trim()) {
                return heading.textContent.trim();
            }
            
            // Check for elements with title-like classes
            const titleElement = parent.querySelector('.title, .video-title, .name, .video-name');
            if (titleElement && titleElement.textContent.trim()) {
                return titleElement.textContent.trim();
            }
            
            parent = parent.parentElement;
            depth++;
        }
        
        return '';
    }

    extractTitleFromUrl(url) {
        if (!url) return '';
        
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const filename = pathname.split('/').pop();
            
            if (filename && filename.includes('.')) {
                // Remove extension
                return filename.replace(/\.[^/.]+$/, '');
            }
            
            return '';
        } catch {
            return '';
        }
    }

    sanitizeTitle(title) {
        // Remove invalid filename characters
        return title
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 100); // Limit length
    }

    async findTikTokVideos() {
        // TikTok video selectors
        const selectors = [
            'video[src]',
            'video source[src]',
            '[data-e2e="browse-video"] video',
            '.video-player video',
            '.feed-video video',
            'div[data-e2e="feed-item"] video'
        ];

        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                const src = element.src || (element.querySelector('source') && element.querySelector('source').src);
                if (src && this.isValidVideoUrl(src)) {
                    this.videos.push({
                         url: src,
                         title: this.extractTikTokTitle(element),
                         element: element,
                         type: 'tiktok',
                         format: this.getVideoFormat(src),
                         size: 'Unknown'
                     });
                }
            }
        }

        // Look for blob URLs in TikTok
        this.findBlobVideos('tiktok');
    }

    async findFacebookVideos() {
        // Facebook video selectors
        const selectors = [
            'video[src]',
            'video source[src]',
            '[data-pagelet="FeedUnit"] video',
            '[data-pagelet="VideoPlayerRoot"] video',
            '.story-bucket-current video',
            '[role="main"] video'
        ];

        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                const src = element.src || (element.querySelector('source') && element.querySelector('source').src);
                if (src && this.isValidVideoUrl(src)) {
                    this.videos.push({
                         url: src,
                         title: this.extractFacebookTitle(element),
                         element: element,
                         type: 'facebook',
                         format: this.getVideoFormat(src),
                         size: 'Unknown'
                     });
                }
            }
        }

        // Look for blob URLs in Facebook
        this.findBlobVideos('facebook');
    }

    async findYouTubeVideos() {
        // YouTube video selectors
        const selectors = [
            'video[src]',
            'video source[src]',
            '.html5-video-player video',
            '#movie_player video',
            '.video-stream'
        ];

        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                const src = element.src || (element.querySelector('source') && element.querySelector('source').src);
                if (src && this.isValidVideoUrl(src)) {
                    this.videos.push({
                         url: src,
                         title: this.extractYouTubeTitle(element),
                         element: element,
                         type: 'youtube',
                         format: this.getVideoFormat(src),
                         size: 'Unknown'
                     });
                }
            }
        }

        // Look for blob URLs in YouTube
        this.findBlobVideos('youtube');
    }

    async findInstagramVideos() {
        const selectors = [
            'video[src]',
            'video source[src]',
            'article video',
            '[role="presentation"] video'
        ];

        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                const src = element.src || (element.querySelector('source') && element.querySelector('source').src);
                if (src && this.isValidVideoUrl(src)) {
                    this.videos.push({
                         url: src,
                         title: this.extractInstagramTitle(element),
                         element: element,
                         type: 'instagram',
                         format: this.getVideoFormat(src),
                         size: 'Unknown'
                     });
                }
            }
        }

        this.findBlobVideos('instagram');
    }

    async findTwitterVideos() {
        const selectors = [
            'video[src]',
            'video source[src]',
            '[data-testid="videoPlayer"] video',
            '.media-container video'
        ];

        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                const src = element.src || (element.querySelector('source') && element.querySelector('source').src);
                if (src && this.isValidVideoUrl(src)) {
                    this.videos.push({
                         url: src,
                         title: this.extractTwitterTitle(element),
                         element: element,
                         type: 'twitter',
                         format: this.getVideoFormat(src),
                         size: 'Unknown'
                     });
                }
            }
        }

        this.findBlobVideos('twitter');
    }

    async findTwitchVideos() {
        const selectors = [
            'video[src]',
            'video source[src]',
            '.video-player video',
            '[data-a-target="player-overlay-click-handler"] video'
        ];

        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                const src = element.src || (element.querySelector('source') && element.querySelector('source').src);
                if (src && this.isValidVideoUrl(src)) {
                    this.videos.push({
                         url: src,
                         title: this.extractTwitchTitle(element),
                         element: element,
                         type: 'twitch',
                         format: this.getVideoFormat(src),
                         size: 'Unknown'
                     });
                }
            }
        }

        this.findBlobVideos('twitch');
    }

    findBlobVideos(platform) {
        // Find videos with blob URLs (common in modern platforms)
        const videoElements = document.querySelectorAll('video');
        for (const video of videoElements) {
            if (video.src && video.src.startsWith('blob:')) {
                this.videos.push({
                     url: video.src,
                     title: this.extractPlatformTitle(video, platform),
                     element: video,
                     type: platform + '_blob',
                     format: 'blob',
                     size: 'Unknown',
                     downloadable: false,
                     reason: 'Blob URLs không thể tải xuống trực tiếp từ extension. Hãy thử right-click và "Save video as..." trên video.',
                     alternative: 'Sử dụng browser\'s built-in save feature hoặc screen recording tools'
                 });
            }
        }
    }

    extractTikTokTitle(element) {
        // Try to find TikTok video title
        const titleSelectors = [
            '[data-e2e="browse-video-desc"]',
            '.video-meta-caption',
            '.tt-video-meta-caption',
            'h1'
        ];

        for (const selector of titleSelectors) {
            const titleElement = document.querySelector(selector);
            if (titleElement && titleElement.textContent.trim()) {
                return this.sanitizeTitle(titleElement.textContent.trim());
            }
        }

        return 'TikTok Video';
    }

    extractFacebookTitle(element) {
        // Try to find Facebook video title
        const titleSelectors = [
            '[data-ad-preview="message"]',
            '.userContent',
            '[data-testid="post_message"]',
            'h3'
        ];

        for (const selector of titleSelectors) {
            const titleElement = document.querySelector(selector);
            if (titleElement && titleElement.textContent.trim()) {
                return this.sanitizeTitle(titleElement.textContent.trim());
            }
        }

        return 'Facebook Video';
    }

    extractYouTubeTitle(element) {
        // Try to find YouTube video title
        const titleSelectors = [
            'h1.title',
            '.watch-title',
            '#container h1',
            'meta[property="og:title"]'
        ];

        for (const selector of titleSelectors) {
            const titleElement = document.querySelector(selector);
            if (titleElement) {
                const title = titleElement.textContent || titleElement.content;
                if (title && title.trim()) {
                    return this.sanitizeTitle(title.trim());
                }
            }
        }

        return 'YouTube Video';
    }

    extractInstagramTitle(element) {
        const titleSelectors = [
            'meta[property="og:title"]',
            'h1',
            '.caption'
        ];

        for (const selector of titleSelectors) {
            const titleElement = document.querySelector(selector);
            if (titleElement) {
                const title = titleElement.textContent || titleElement.content;
                if (title && title.trim()) {
                    return this.sanitizeTitle(title.trim());
                }
            }
        }

        return 'Instagram Video';
    }

    extractTwitterTitle(element) {
        const titleSelectors = [
            '[data-testid="tweetText"]',
            'meta[property="og:title"]',
            '.tweet-text'
        ];

        for (const selector of titleSelectors) {
            const titleElement = document.querySelector(selector);
            if (titleElement) {
                const title = titleElement.textContent || titleElement.content;
                if (title && title.trim()) {
                    return this.sanitizeTitle(title.trim());
                }
            }
        }

        return 'Twitter Video';
    }

    extractTwitchTitle(element) {
        const titleSelectors = [
            'h1[data-a-target="stream-title"]',
            '.channel-info-content h1',
            'meta[property="og:title"]'
        ];

        for (const selector of titleSelectors) {
            const titleElement = document.querySelector(selector);
            if (titleElement) {
                const title = titleElement.textContent || titleElement.content;
                if (title && title.trim()) {
                    return this.sanitizeTitle(title.trim());
                }
            }
        }

        return 'Twitch Video';
    }

    extractPlatformTitle(element, platform) {
        switch (platform) {
            case 'tiktok':
                return this.extractTikTokTitle(element);
            case 'facebook':
                return this.extractFacebookTitle(element);
            case 'youtube':
                return this.extractYouTubeTitle(element);
            case 'instagram':
                return this.extractInstagramTitle(element);
            case 'twitter':
                return this.extractTwitterTitle(element);
            case 'twitch':
                return this.extractTwitchTitle(element);
            default:
                return this.extractVideoTitle(element);
        }
    }

    removeDuplicates(videos) {
        const seen = new Set();
        return videos.filter(video => {
            if (seen.has(video.src)) {
                return false;
            }
            seen.add(video.src);
            return true;
        });
    }
    }

    // Initialize video detector when content script loads
    window.videoDetectorInstance = new VideoDetector();
}