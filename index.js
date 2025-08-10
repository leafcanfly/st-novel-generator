(async function() {
    'use strict';

    const MODULE_NAME = 'novel_generator';
    
    const defaultSettings = {
        enabled: true,
        apiProvider: 'openai',
        apiKey: '',
        apiUrl: '',
        model: 'gpt-4',
        maxTokens: 4000,
        temperature: 0.7,
        narrativeStyle: 'third_person',
        includeActions: true,
        includeOOC: false,
        chapterLength: 10,
        outputFormat: 'markdown'
    };

    const context = SillyTavern.getContext();
    const { extensionSettings, saveSettingsDebounced, characters, chat } = context;

    function getSettings() {
        if (!extensionSettings[MODULE_NAME]) {
            extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
        }
        
        for (const key in defaultSettings) {
            if (extensionSettings[MODULE_NAME][key] === undefined) {
                extensionSettings[MODULE_NAME][key] = defaultSettings[key];
            }
        }
        
        return extensionSettings[MODULE_NAME];
    }

    class ChatParser {
        constructor(settings) {
            this.settings = settings;
        }

        parseMessages(messages) {
            const parsed = [];
            
            for (const msg of messages) {
                if (!this.settings.includeOOC && this.isOOC(msg)) {
                    continue;
                }
                
                const parsedMsg = {
                    character: msg.name || 'Unknown',
                    content: msg.mes || '',
                    isUser: msg.is_user || false,
                    timestamp: msg.send_date,
                    type: this.detectMessageType(msg)
                };
                
                parsed.push(parsedMsg);
            }
            
            return parsed;
        }

        isOOC(message) {
            const content = message.mes || '';
            return content.startsWith('((') || content.startsWith('(OOC:');
        }

        detectMessageType(message) {
            const content = message.mes || '';
            if (content.startsWith('*') && content.endsWith('*')) {
                return 'action';
            }
            if (content.includes('*') && this.settings.includeActions) {
                return 'mixed';
            }
            return 'dialogue';
        }

        createChapters(messages) {
            const chapters = [];
            const chapterSize = this.settings.chapterLength;
            
            for (let i = 0; i < messages.length; i += chapterSize) {
                chapters.push({
                    title: 'Chapter ' + (Math.floor(i / chapterSize) + 1),
                    messages: messages.slice(i, i + chapterSize)
                });
            }
            
            return chapters;
        }
    }

    class NovelGenerator {
        constructor(settings) {
            this.settings = settings;
        }

        async generateNovel(parsedMessages) {
            try {
                const chapters = new ChatParser(this.settings).createChapters(parsedMessages);
                const novel = {
                    title: this.generateTitle(),
                    chapters: []
                };

                for (const chapter of chapters) {
                    const generatedChapter = await this.generateChapter(chapter);
                    novel.chapters.push(generatedChapter);
                    await this.delay(1000);
                }

                return novel;
            } catch (error) {
                console.error('Novel generation failed:', error);
                throw error;
            }
        }

        async generateChapter(chapter) {
            const prompt = this.buildChapterPrompt(chapter);
            const response = await this.callAPI(prompt);
            
            return {
                title: chapter.title,
                content: response,
                originalMessages: chapter.messages.length
            };
        }

        buildChapterPrompt(chapter) {
            const messages = chapter.messages;
            const chatText = messages.map(msg => {
                return msg.character + ': ' + msg.content;
            }).join('\n\n');

            return 'Transform the following chat conversation into a well-written novel chapter.\n\nNarrative Style: ' + this.settings.narrativeStyle.replace('_', ' ') + '\n\nChat Content:\n' + chatText + '\n\nInstructions:\n- Convert dialogue and actions into flowing narrative prose\n- Maintain character personalities and relationships\n- Add descriptive elements where appropriate\n- Ensure smooth transitions between scenes\n- Write in ' + this.settings.narrativeStyle.replace('_', ' ') + ' perspective\n- Make it engaging and novel-like\n\nChapter Content:';
        }

        async callAPI(prompt) {
            switch (this.settings.apiProvider) {
                case 'openai':
                    return await this.callOpenAI(prompt);
                case 'anthropic':
                    return await this.callAnthropic(prompt);
                default:
                    throw new Error('Invalid API provider');
            }
        }

        async callOpenAI(prompt) {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + this.settings.apiKey
                },
                body: JSON.stringify({
                    model: this.settings.model,
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: this.settings.maxTokens,
                    temperature: this.settings.temperature
                })
            });

            if (!response.ok) {
                throw new Error('OpenAI API error: ' + response.statusText);
            }

            const data = await response.json();
            return data.choices[0].message.content;
        }

        async callAnthropic(prompt) {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.settings.apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: this.settings.model,
                    max_tokens: this.settings.maxTokens,
                    temperature: this.settings.temperature,
                    messages: [{ role: 'user', content: prompt }]
                })
            });

            if (!response.ok) {
                throw new Error('Anthropic API error: ' + response.statusText);
            }

            const data = await response.json();
            return data.content[0].text;
        }

        generateTitle() {
            const currentChar = characters[context.characterId];
            const charName = currentChar?.name || 'Character';
            return 'A Story with ' + charName;
        }

        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
    }

    class NovelExporter {
        static export(novel, format) {
            switch (format) {
                case 'markdown':
                    return this.exportMarkdown(novel);
                case 'html':
                    return this.exportHTML(novel);
                default:
                    return this.exportPlain(novel);
            }
        }

        static exportMarkdown(novel) {
            let output = '# ' + novel.title + '\n\n';
            for (const chapter of novel.chapters) {
                output += '## ' + chapter.title + '\n\n';
                output += chapter.content + '\n\n---\n\n';
            }
            return output;
        }

        static exportHTML(novel) {
            let output = '<!DOCTYPE html><html><head><title>' + novel.title + '</title><style>body{font-family:serif;line-height:1.6;max-width:800px;margin:0 auto;padding:20px;}h1{text-align:center;}h2{border-bottom:1px solid #ccc;padding-bottom:10px;}.chapter{margin-bottom:2em;}</style></head><body><h1>' + novel.title + '</h1>';
            for (const chapter of novel.chapters) {
                output += '<div class="chapter"><h2>' + chapter.title + '</h2><p>' + chapter.content.replace(/\n/g, '</p><p>') + '</p></div>';
            }
            output += '</body></html>';
            return output;
        }

        static exportPlain(novel) {
            let output = novel.title + '\n' + '='.repeat(novel.title.length) + '\n\n';
            for (const chapter of novel.chapters) {
                output += chapter.title + '\n' + '-'.repeat(chapter.title.length) + '\n\n';
                output += chapter.content + '\n\n\n';
            }
            return output;
        }

        static download(content, filename, mimeType) {
            const blob = new Blob([content], { type: mimeType || 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    }

    async function generateNovel() {
        const settings = getSettings();
        
        if (!settings.apiKey) {
            toastr.error('Please set your API key in settings first!');
            return;
        }

        if (!chat || chat.length === 0) {
            toastr.error('No chat history found!');
            return;
        }

        try {
            $('#novel_progress').show();
            $('#novel_progress_fill').css('width', '0%');
            $('#novel_status').text('Parsing chat history...');

            const parser = new ChatParser(settings);
            const parsedMessages = parser.parseMessages(chat);
            
            if (parsedMessages.length === 0) {
                toastr.error('No valid messages found to convert!');
                return;
            }

            $('#novel_progress_fill').css('width', '20%');
            $('#novel_status').text('Generating novel...');

            const generator = new NovelGenerator(settings);
            const novel = await generator.generateNovel(parsedMessages);

            $('#novel_progress_fill').css('width', '90%');
            $('#novel_status').text('Formatting output...');

            const content = NovelExporter.export(novel, settings.outputFormat);
            const ext = settings.outputFormat === 'html' ? 'html' : settings.outputFormat === 'markdown' ? 'md' : 'txt';
            const filename = novel.title.replace(/[^a-z0-9]/gi, '_') + '.' + ext;
            const mimeType = settings.outputFormat === 'html' ? 'text/html' : 'text/plain';
            
            NovelExporter.download(content, filename, mimeType);

            $('#novel_progress_fill').css('width', '100%');
            $('#novel_status').text('Complete!');
            toastr.success('Novel generated and downloaded!');
            
            setTimeout(() => $('#novel_progress').hide(), 2000);

        } catch (error) {
            console.error('Error generating novel:', error);
            toastr.error('Failed to generate novel: ' + error.message);
            $('#novel_progress').hide();
        }
    }

    function saveSettings() {
        const settings = getSettings();
        settings.apiProvider = $('#novel_api_provider').val();
        settings.apiKey = $('#novel_api_key').val();
        settings.model = $('#novel_model').val();
        settings.narrativeStyle = $('#novel_narrative_style').val();
        settings.chapterLength = parseInt($('#novel_chapter_length').val());
        settings.outputFormat = $('#novel_output_format').val();
        settings.includeActions = $('#novel_include_actions').prop('checked');
        settings.includeOOC = $('#novel_include_ooc').prop('checked');
        saveSettingsDebounced();
        toastr.success('Settings saved!');
    }

    function loadSettings() {
        const settings = getSettings();
        $('#novel_api_provider').val(settings.apiProvider);
        $('#novel_api_key').val(settings.apiKey);
        $('#novel_model').val(settings.model);
        $('#novel_narrative_style').val(settings.narrativeStyle);
        $('#novel_chapter_length').val(settings.chapterLength);
        $('#novel_output_format').val(settings.outputFormat);
        $('#novel_include_actions').prop('checked', settings.includeActions);
        $('#novel_include_ooc').prop('checked', settings.includeOOC);
    }

    function init() {
        const html = '<div id="novel_generator_controls" class="extension-settings"><h3>Novel Generator</h3><button id="generate_novel_btn" class="menu_button">Generate Novel</button><button id="novel_settings_btn" class="menu_button">Settings</button><div id="novel_progress" style="display:none;margin-top:10px;"><div style="width:100%;background:#ddd;border-radius:10px;"><div id="novel_progress_fill" style="width:0%;height:20px;background:#4CAF50;border-radius:10px;transition:width 0.3s;"></div></div><div id="novel_status" style="text-align:center;margin-top:5px;">Ready</div></div><div id="novel_settings_panel" style="display:none;margin-top:15px;padding:15px;border:1px solid #ccc;border-radius:5px;"><h4>Settings</h4><label>API Provider:</label><select id="novel_api_provider"><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select><br><br><label>API Key:</label><input type="password" id="novel_api_key" style="width:100%;"><br><br><label>Model:</label><input type="text" id="novel_model" placeholder="gpt-4" style="width:100%;"><br><br><label>Narrative Style:</label><select id="novel_narrative_style"><option value="first_person">First Person</option><option value="third_person">Third Person</option><option value="omniscient">Omniscient</option></select><br><br><label>Messages per Chapter:</label><input type="number" id="novel_chapter_length" min="5" max="50" value="10" style="width:100%;"><br><br><label>Output Format:</label><select id="novel_output_format"><option value="markdown">Markdown</option><option value="html">HTML</option><option value="plain">Plain Text</option></select><br><br><label><input type="checkbox" id="novel_include_actions"> Include Actions</label><br><label><input type="checkbox" id="novel_include_ooc"> Include OOC</label><br><br><button id="save_novel_settings" class="menu_button">Save Settings</button></div></div>';

        $('#extensions_settings2').append(html);
        
        $('#generate_novel_btn').on('click', generateNovel);
        $('#novel_settings_btn').on('click', () => $('#novel_settings_panel').toggle());
        $('#save_novel_settings').on('click', saveSettings);
        
        loadSettings();
        console.log('Novel Generator extension loaded');
    }

    if (typeof SillyTavern !== 'undefined') {
        init();
    } else {
        $(document).ready(init);
    }

})();
