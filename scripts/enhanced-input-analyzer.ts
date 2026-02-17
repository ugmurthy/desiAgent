interface ToolIndicator {
  category: string;
  confidence: number;
  suggestedTools: string[];
  keywords: string[];
}

interface EnhancedTaskComplexity {
  isComplex: boolean;
  estimatedSubTasks: number;
  requiresDecomposition: boolean;
  confidence: number;
  toolsRequired: ToolIndicator[];
  urls: URLInfo[];
  actionPatterns: ActionPattern[];
  complexityFactors: ComplexityFactors;
}

interface URLInfo {
  url: string;
  type: 'api' | 'web' | 'file' | 'unknown';
  requiresTool: boolean;
  suggestedAction: string;
}

interface ActionPattern {
  action: string;
  count: number;
  toolCategory: string;
  priority: number;
}

interface ComplexityFactors {
  multipleQuestions: number;
  sequentialTasks: number;
  multipleActions: number;
  toolRequirements: number;
  dataProcessing: number;
  externalResources: number;
}

export class EnhancedInputAnalyzer {
  private toolKeywords: Map<string, ToolCategory>;
  private actionVerbs: Map<string, ActionCategory>;
  
  constructor() {
    this.initializeKeywordMaps();
  }
  
  private initializeKeywordMaps() {
    this.toolKeywords = new Map([
      // Web & Search
      ['search', { category: 'web_search', tools: ['google_search', 'bing_search', 'web_scraper'], weight: 2 }],
      ['google', { category: 'web_search', tools: ['google_search'], weight: 2 }],
      ['browse', { category: 'web_browser', tools: ['web_browser', 'web_scraper'], weight: 2 }],
      ['scrape', { category: 'web_scraper', tools: ['web_scraper', 'html_parser'], weight: 2 }],
      ['crawl', { category: 'web_scraper', tools: ['web_crawler'], weight: 2 }],
      ['fetch', { category: 'web_request', tools: ['http_client', 'api_client'], weight: 2 }],
      ['download', { category: 'web_request', tools: ['file_downloader', 'http_client'], weight: 2 }],
      
      // File Operations
      ['read', { category: 'file_reader', tools: ['file_reader', 'document_parser'], weight: 1.5 }],
      ['write', { category: 'file_writer', tools: ['file_writer', 'document_creator'], weight: 1.5 }],
      ['save', { category: 'file_writer', tools: ['file_writer', 'storage'], weight: 1.5 }],
      ['load', { category: 'file_reader', tools: ['file_reader', 'data_loader'], weight: 1.5 }],
      ['parse', { category: 'file_parser', tools: ['json_parser', 'xml_parser', 'csv_parser'], weight: 1.5 }],
      ['open', { category: 'file_reader', tools: ['file_reader'], weight: 1 }],
      ['create file', { category: 'file_writer', tools: ['file_writer'], weight: 2 }],
      ['delete file', { category: 'file_manager', tools: ['file_manager'], weight: 1.5 }],
      
      // Communication
      ['email', { category: 'email', tools: ['email_sender', 'smtp_client'], weight: 2 }],
      ['send email', { category: 'email', tools: ['email_sender'], weight: 2.5 }],
      ['send message', { category: 'messaging', tools: ['message_sender', 'notification_service'], weight: 2 }],
      ['notify', { category: 'notification', tools: ['notification_service'], weight: 1.5 }],
      ['slack', { category: 'messaging', tools: ['slack_client'], weight: 2 }],
      ['teams', { category: 'messaging', tools: ['teams_client'], weight: 2 }],
      ['sms', { category: 'messaging', tools: ['sms_sender'], weight: 2 }],
      
      // Data & Database
      ['query', { category: 'database', tools: ['sql_executor', 'database_client'], weight: 2 }],
      ['database', { category: 'database', tools: ['database_client'], weight: 2 }],
      ['sql', { category: 'database', tools: ['sql_executor'], weight: 2 }],
      ['insert', { category: 'database', tools: ['database_client'], weight: 1.5 }],
      ['update', { category: 'database', tools: ['database_client'], weight: 1.5 }],
      ['delete', { category: 'database', tools: ['database_client'], weight: 1.5 }],
      ['store', { category: 'storage', tools: ['storage_service', 'database_client'], weight: 1.5 }],
      ['retrieve', { category: 'data_retrieval', tools: ['database_client', 'api_client'], weight: 1.5 }],
      
      // API & Integration
      ['api', { category: 'api_client', tools: ['api_client', 'http_client'], weight: 2 }],
      ['rest', { category: 'api_client', tools: ['rest_client'], weight: 2 }],
      ['graphql', { category: 'api_client', tools: ['graphql_client'], weight: 2 }],
      ['webhook', { category: 'webhook', tools: ['webhook_sender'], weight: 2 }],
      ['post', { category: 'http_request', tools: ['http_client'], weight: 1.5 }],
      ['get', { category: 'http_request', tools: ['http_client'], weight: 1 }],
      ['put', { category: 'http_request', tools: ['http_client'], weight: 1.5 }],
      
      // Code & Execution
      ['execute', { category: 'code_executor', tools: ['code_executor', 'script_runner'], weight: 2 }],
      ['run', { category: 'code_executor', tools: ['code_executor', 'command_runner'], weight: 1.5 }],
      ['compile', { category: 'compiler', tools: ['code_compiler'], weight: 2 }],
      ['deploy', { category: 'deployment', tools: ['deployment_service'], weight: 2 }],
      ['shell', { category: 'shell', tools: ['shell_executor'], weight: 2 }],
      ['command', { category: 'shell', tools: ['command_runner'], weight: 1.5 }],
      
      // Analysis & Processing
      ['analyze', { category: 'analyzer', tools: ['data_analyzer', 'text_analyzer'], weight: 1.5 }],
      ['calculate', { category: 'calculator', tools: ['calculator', 'math_processor'], weight: 1.5 }],
      ['process', { category: 'processor', tools: ['data_processor'], weight: 1.5 }],
      ['transform', { category: 'transformer', tools: ['data_transformer'], weight: 1.5 }],
      ['filter', { category: 'filter', tools: ['data_filter'], weight: 1 }],
      ['sort', { category: 'sorter', tools: ['data_sorter'], weight: 1 }],
      ['aggregate', { category: 'aggregator', tools: ['data_aggregator'], weight: 1.5 }],
      ['summarize', { category: 'summarizer', tools: ['text_summarizer'], weight: 1.5 }],
      
      // Image & Media
      ['image', { category: 'image_processor', tools: ['image_processor', 'vision_api'], weight: 2 }],
      ['generate image', { category: 'image_generator', tools: ['image_generator', 'dall_e'], weight: 2.5 }],
      ['video', { category: 'video_processor', tools: ['video_processor'], weight: 2 }],
      ['ocr', { category: 'ocr', tools: ['ocr_service'], weight: 2 }],
      ['screenshot', { category: 'screenshot', tools: ['screenshot_tool'], weight: 2 }],
      
      // Calendar & Scheduling
      ['schedule', { category: 'scheduler', tools: ['scheduler', 'calendar_api'], weight: 2 }],
      ['calendar', { category: 'calendar', tools: ['calendar_api'], weight: 2 }],
      ['remind', { category: 'reminder', tools: ['reminder_service'], weight: 1.5 }],
      ['meeting', { category: 'meeting', tools: ['calendar_api', 'meeting_scheduler'], weight: 2 }],
      
      // Authentication & Security
      ['authenticate', { category: 'auth', tools: ['auth_service'], weight: 2 }],
      ['login', { category: 'auth', tools: ['auth_service'], weight: 1.5 }],
      ['encrypt', { category: 'encryption', tools: ['encryption_service'], weight: 2 }],
      ['decrypt', { category: 'encryption', tools: ['encryption_service'], weight: 2 }],
      
      // Monitoring & Logging
      ['log', { category: 'logger', tools: ['logger', 'log_service'], weight: 1 }],
      ['monitor', { category: 'monitoring', tools: ['monitoring_service'], weight: 1.5 }],
      ['track', { category: 'tracking', tools: ['tracking_service', 'analytics'], weight: 1.5 }],
      ['measure', { category: 'metrics', tools: ['metrics_collector'], weight: 1.5 }],
    ]);
    
    this.actionVerbs = new Map([
      ['search', { type: 'retrieval', subtaskMultiplier: 1.5, requiresExternal: true }],
      ['find', { type: 'retrieval', subtaskMultiplier: 1.5, requiresExternal: true }],
      ['lookup', { type: 'retrieval', subtaskMultiplier: 1.5, requiresExternal: true }],
      ['fetch', { type: 'retrieval', subtaskMultiplier: 1.5, requiresExternal: true }],
      ['get', { type: 'retrieval', subtaskMultiplier: 1.2, requiresExternal: false }],
      
      ['create', { type: 'creation', subtaskMultiplier: 2, requiresExternal: false }],
      ['generate', { type: 'creation', subtaskMultiplier: 2, requiresExternal: false }],
      ['build', { type: 'creation', subtaskMultiplier: 2.5, requiresExternal: false }],
      ['make', { type: 'creation', subtaskMultiplier: 1.5, requiresExternal: false }],
      ['write', { type: 'creation', subtaskMultiplier: 2, requiresExternal: false }],
      
      ['send', { type: 'communication', subtaskMultiplier: 1.5, requiresExternal: true }],
      ['email', { type: 'communication', subtaskMultiplier: 2, requiresExternal: true }],
      ['notify', { type: 'communication', subtaskMultiplier: 1.5, requiresExternal: true }],
      ['message', { type: 'communication', subtaskMultiplier: 1.5, requiresExternal: true }],
      
      ['analyze', { type: 'analysis', subtaskMultiplier: 2, requiresExternal: false }],
      ['compare', { type: 'analysis', subtaskMultiplier: 2, requiresExternal: false }],
      ['evaluate', { type: 'analysis', subtaskMultiplier: 2, requiresExternal: false }],
      ['assess', { type: 'analysis', subtaskMultiplier: 2, requiresExternal: false }],
      ['summarize', { type: 'analysis', subtaskMultiplier: 1.5, requiresExternal: false }],
      
      ['update', { type: 'modification', subtaskMultiplier: 1.5, requiresExternal: true }],
      ['modify', { type: 'modification', subtaskMultiplier: 1.5, requiresExternal: false }],
      ['edit', { type: 'modification', subtaskMultiplier: 1.5, requiresExternal: false }],
      ['change', { type: 'modification', subtaskMultiplier: 1.5, requiresExternal: false }],
      
      ['delete', { type: 'deletion', subtaskMultiplier: 1, requiresExternal: true }],
      ['remove', { type: 'deletion', subtaskMultiplier: 1, requiresExternal: false }],
      
      ['execute', { type: 'execution', subtaskMultiplier: 1.5, requiresExternal: true }],
      ['run', { type: 'execution', subtaskMultiplier: 1.5, requiresExternal: true }],
      ['process', { type: 'execution', subtaskMultiplier: 2, requiresExternal: false }],
    ]);
  }
  
  async analyzeComplexity(prompt: string): Promise<EnhancedTaskComplexity> {
    const lowerPrompt = prompt.toLowerCase();
    
    // Detect URLs
    const urls = this.extractURLs(prompt);
    
    // Detect tool requirements
    const toolsRequired = this.detectToolRequirements(lowerPrompt);
    
    // Detect action patterns
    const actionPatterns = this.detectActionPatterns(lowerPrompt);
    
    // Calculate complexity factors
    const factors = this.calculateComplexityFactors(
      prompt,
      lowerPrompt,
      urls,
      toolsRequired,
      actionPatterns
    );
    
    // Estimate subtasks
    const estimatedSubTasks = this.estimateSubTasks(
      factors,
      toolsRequired,
      actionPatterns,
      urls
    );
    
    // Calculate overall complexity score
    const complexityScore = this.calculateComplexityScore(factors);
    
    return {
      isComplex: complexityScore >= 0.4,
      estimatedSubTasks,
      requiresDecomposition: estimatedSubTasks > 2 || complexityScore >= 0.5,
      confidence: Math.min(complexityScore, 1),
      toolsRequired,
      urls,
      actionPatterns,
      complexityFactors: factors,
    };
  }
  
  private extractURLs(prompt: string): URLInfo[] {
    // Enhanced URL regex that catches various formats
    const urlRegex = /(?:https?:\/\/|www\.)[^\s<>"\[\]{}|\\^`]+/gi;
    const filePathRegex = /(?:\/[^\s]+\.[a-z]{2,4}|[a-z]:\\[^\s]+\.[a-z]{2,4})/gi;
    const apiPathRegex = /\/api\/[^\s]+/gi;
    
    const urls: URLInfo[] = [];
    const matches = [
      ...Array.from(prompt.matchAll(urlRegex)),
      ...Array.from(prompt.matchAll(filePathRegex)),
      ...Array.from(prompt.matchAll(apiPathRegex)),
    ];
    
    for (const match of matches) {
      const url = match[0];
      urls.push({
        url,
        type: this.classifyURL(url),
        requiresTool: true,
        suggestedAction: this.suggestURLAction(url),
      });
    }
    
    return urls;
  }
  
  private classifyURL(url: string): 'api' | 'web' | 'file' | 'unknown' {
    if (url.includes('/api/') || url.includes('/v1/') || url.includes('/v2/')) {
      return 'api';
    }
    if (url.match(/\.[a-z]{2,4}$/i)) {
      const ext = url.split('.').pop()?.toLowerCase();
      if (['json', 'xml', 'csv', 'pdf', 'doc', 'docx', 'txt'].includes(ext || '')) {
        return 'file';
      }
    }
    if (url.startsWith('http') || url.startsWith('www')) {
      return 'web';
    }
    return 'unknown';
  }
  
  private suggestURLAction(url: string): string {
    const type = this.classifyURL(url);
    switch (type) {
      case 'api':
        return 'fetch_api_data';
      case 'file':
        return 'download_and_parse';
      case 'web':
        return 'scrape_or_browse';
      default:
        return 'fetch_content';
    }
  }
  
  private detectToolRequirements(prompt: string): ToolIndicator[] {
    const indicators: Map<string, ToolIndicator> = new Map();
    
    // Check for tool keywords
    for (const [keyword, category] of this.toolKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = prompt.match(regex);
      
      if (matches) {
        const key = category.category;
        
        if (indicators.has(key)) {
          const existing = indicators.get(key)!;
          existing.confidence = Math.min(
            existing.confidence + (matches.length * 0.1 * category.weight),
            1
          );
          existing.keywords.push(...matches.map(m => m.toLowerCase()));
        } else {
          indicators.set(key, {
            category: category.category,
            confidence: Math.min(matches.length * 0.2 * category.weight, 1),
            suggestedTools: category.tools,
            keywords: matches.map(m => m.toLowerCase()),
          });
        }
      }
    }
    
    // Check for common patterns
    this.detectPatternBasedTools(prompt, indicators);
    
    return Array.from(indicators.values())
      .sort((a, b) => b.confidence - a.confidence);
  }
  
  private detectPatternBasedTools(
    prompt: string,
    indicators: Map<string, ToolIndicator>
  ): void {
    // Email patterns
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    if (emailPattern.test(prompt)) {
      this.addToolIndicator(indicators, 'email', 0.8, ['email_sender'], ['email address found']);
    }
    
    // File extensions
    const fileExtPattern = /\.(json|xml|csv|pdf|doc|docx|txt|xlsx|xls|zip|tar|gz)\b/gi;
    const fileMatches = prompt.match(fileExtPattern);
    if (fileMatches) {
      this.addToolIndicator(
        indicators,
        'file_parser',
        0.7,
        ['file_reader', 'document_parser'],
        fileMatches
      );
    }
    
    // Code/SQL blocks
    if (prompt.includes('```') || /SELECT|INSERT|UPDATE|DELETE.*FROM/i.test(prompt)) {
      this.addToolIndicator(
        indicators,
        'code_executor',
        0.8,
        ['sql_executor', 'code_executor'],
        ['code block detected']
      );
    }
    
    // Date/time references (suggesting calendar/scheduling)
    const datePattern = /\b(?:today|tomorrow|next week|monday|january|\d{1,2}\/\d{1,2}\/\d{2,4})\b/gi;
    const dateMatches = prompt.match(datePattern);
    if (dateMatches && dateMatches.length > 1) {
      this.addToolIndicator(
        indicators,
        'calendar',
        0.6,
        ['calendar_api', 'scheduler'],
        dateMatches
      );
    }
    
    // Number crunching (suggesting calculator/analysis)
    const mathPattern = /\b(?:calculate|sum|average|mean|median|total|count|percentage)\b/gi;
    if (mathPattern.test(prompt)) {
      this.addToolIndicator(
        indicators,
        'calculator',
        0.7,
        ['calculator', 'data_analyzer'],
        ['math operation detected']
      );
    }
  }
  
  private addToolIndicator(
    indicators: Map<string, ToolIndicator>,
    category: string,
    confidence: number,
    tools: string[],
    keywords: string[]
  ): void {
    if (indicators.has(category)) {
      const existing = indicators.get(category)!;
      existing.confidence = Math.min(existing.confidence + confidence * 0.5, 1);
      existing.keywords.push(...keywords);
    } else {
      indicators.set(category, {
        category,
        confidence,
        suggestedTools: tools,
        keywords,
      });
    }
  }
  
  private detectActionPatterns(prompt: string): ActionPattern[] {
    const patterns: Map<string, ActionPattern> = new Map();
    
    for (const [verb, category] of this.actionVerbs) {
      const regex = new RegExp(`\\b${verb}\\b`, 'gi');
      const matches = prompt.match(regex);
      
      if (matches) {
        const count = matches.length;
        const key = `${verb}_${category.type}`;
        
        patterns.set(key, {
          action: verb,
          count,
          toolCategory: category.type,
          priority: Math.ceil(count * category.subtaskMultiplier),
        });
      }
    }
    
    return Array.from(patterns.values())
      .sort((a, b) => b.priority - a.priority);
  }
  
  private calculateComplexityFactors(
    prompt: string,
    lowerPrompt: string,
    urls: URLInfo[],
    tools: ToolIndicator[],
    actions: ActionPattern[]
  ): ComplexityFactors {
    return {
      multipleQuestions: (prompt.match(/\?/g) || []).length,
      sequentialTasks: this.countSequentialIndicators(lowerPrompt),
      multipleActions: actions.length,
      toolRequirements: tools.length,
      dataProcessing: this.countDataProcessingIndicators(lowerPrompt),
      externalResources: urls.length + tools.filter(t => t.confidence > 0.5).length,
    };
  }
  
  private countSequentialIndicators(prompt: string): number {
    const sequentialWords = [
      'then', 'after', 'next', 'following', 'subsequently',
      'first', 'second', 'third', 'finally', 'lastly',
      'before', 'once', 'when', 'after that'
    ];
    
    return sequentialWords.reduce((count, word) => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      return count + (prompt.match(regex) || []).length;
    }, 0);
  }
  
  private countDataProcessingIndicators(prompt: string): number {
    const processingWords = [
      'analyze', 'process', 'transform', 'filter', 'sort',
      'aggregate', 'summarize', 'calculate', 'compute', 'parse'
    ];
    
    return processingWords.reduce((count, word) => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      return count + (prompt.match(regex) || []).length;
    }, 0);
  }
  
  private estimateSubTasks(
    factors: ComplexityFactors,
    tools: ToolIndicator[],
    actions: ActionPattern[],
    urls: URLInfo[]
  ): number {
    let subtasks = 1; // Start with base task
    
    // Add subtasks based on questions (each question might be a subtask)
    subtasks += factors.multipleQuestions;
    
    // Add subtasks based on sequential indicators
    subtasks += Math.ceil(factors.sequentialTasks / 2);
    
    // Each high-confidence tool requirement adds 1-2 subtasks
    subtasks += tools
      .filter(t => t.confidence > 0.6)
      .length * 1.5;
    
    // Each URL typically requires 1-2 subtasks (fetch + process)
    subtasks += urls.length * 1.5;
    
    // Action patterns with high priority add subtasks
    subtasks += actions
      .filter(a => a.priority > 2)
      .reduce((sum, a) => sum + Math.ceil(a.priority / 2), 0);
    
    // Data processing adds complexity
    subtasks += Math.ceil(factors.dataProcessing / 2);
    
    // Cap at reasonable maximum
    return Math.min(Math.ceil(subtasks), 15);
  }
  
  private calculateComplexityScore(factors: ComplexityFactors): number {
    const weights = {
      multipleQuestions: 0.15,
      sequentialTasks: 0.20,
      multipleActions: 0.15,
      toolRequirements: 0.25,
      dataProcessing: 0.15,
      externalResources: 0.10,
    };
    
    const normalizedFactors = {
      multipleQuestions: Math.min(factors.multipleQuestions / 3, 1),
      sequentialTasks: Math.min(factors.sequentialTasks / 5, 1),
      multipleActions: Math.min(factors.multipleActions / 5, 1),
      toolRequirements: Math.min(factors.toolRequirements / 4, 1),
      dataProcessing: Math.min(factors.dataProcessing / 4, 1),
      externalResources: Math.min(factors.externalResources / 3, 1),
    };
    
    let score = 0;
    for (const [key, weight] of Object.entries(weights)) {
      score += normalizedFactors[key as keyof ComplexityFactors] * weight;
    }
    
    return score;
  }
  
  // Helper method to get human-readable analysis
  getReadableAnalysis(complexity: EnhancedTaskComplexity): string {
    const parts: string[] = [];
    
    parts.push(`Complexity: ${complexity.isComplex ? 'High' : 'Low'} (${(complexity.confidence * 100).toFixed(0)}% confidence)`);
    parts.push(`Estimated Subtasks: ${complexity.estimatedSubTasks}`);
    
    if (complexity.urls.length > 0) {
      parts.push(`\nURLs Detected: ${complexity.urls.length}`);
      complexity.urls.forEach(url => {
        parts.push(`  - ${url.url} (${url.type}) → ${url.suggestedAction}`);
      });
    }
    
    if (complexity.toolsRequired.length > 0) {
      parts.push(`\nTools Required: ${complexity.toolsRequired.length}`);
      complexity.toolsRequired
        .filter(t => t.confidence > 0.5)
        .slice(0, 5)
        .forEach(tool => {
          parts.push(`  - ${tool.category} (${(tool.confidence * 100).toFixed(0)}%): ${tool.suggestedTools.join(', ')}`);
        });
    }
    
    if (complexity.actionPatterns.length > 0) {
      parts.push(`\nKey Actions:`);
      complexity.actionPatterns
        .slice(0, 5)
        .forEach(action => {
          parts.push(`  - ${action.action} (${action.count}x) - ${action.toolCategory}`);
        });
    }
    
    return parts.join('\n');
  }
}

// Type definitions
interface ToolCategory {
  category: string;
  tools: string[];
  weight: number;
}

interface ActionCategory {
  type: string;
  subtaskMultiplier: number;
  requiresExternal: boolean;
}
