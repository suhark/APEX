/**
 * AI Bot Builder - Natural language to strategy configuration
 * 
 * Users describe their trading strategy in plain English, and AI converts it to JSON/XML bot configuration.
 * If AI needs clarification, it asks questions before generating the final configuration.
 */

import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, Loader2, CheckCircle2, AlertCircle, Copy, Download, RefreshCw, X, ChevronRight, MessageSquare } from 'lucide-react';

// Simple markdown parser for AI responses
function parseMarkdown(text: string): string {
  let html = text;
  
  // Code blocks
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  
  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  
  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  
  // Lists
  html = html.replace(/^\- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  
  // Wrap consecutive list items in ul tags
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  
  // Line breaks
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  
  return `<p>${html}</p>`;
}

// Types for the AI conversation
interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning_details?: any[];
  timestamp?: number;
}

interface ConversationState {
  messages: Message[];
  isComplete: boolean;
  generatedConfig: string | null;
  configFormat: 'json' | 'xml' | null;
  needsClarification: boolean;
}

const OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY || import.meta.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.error('OpenRouter API key is missing. Please set OPENROUTER_API_KEY environment variable.');
}

export function AIBotBuilder() {
  const [conversation, setConversation] = useState<ConversationState>(() => {
    // Load conversation from localStorage on mount
    try {
      const saved = localStorage.getItem('ai_bot_conversation');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load saved conversation:', e);
    }
    return {
      messages: [],
      isComplete: false,
      generatedConfig: null,
      configFormat: null,
      needsClarification: false,
    };
  });
  
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedFormat, setSelectedFormat] = useState<'json' | 'xml'>('json');
  const [copySuccess, setCopySuccess] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation.messages]);

  // Save conversation to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('ai_bot_conversation', JSON.stringify(conversation));
  }, [conversation]);

  const generateSystemPrompt = (format: 'json' | 'xml'): string => {
    return `You are an expert trading bot configuration generator. Your task is to convert natural language strategy descriptions into structured ${format.toUpperCase()} bot configurations.

IMPORTANT BEHAVIOR RULES:
1. If the user's description is incomplete or ambiguous, ASK CLARIFYING QUESTIONS before generating any configuration.
2. Only generate the ${format.toUpperCase()} configuration when you have ALL necessary information.
3. When asking questions, be specific about what information you need.
4. When you have enough information, generate a complete, valid ${format.toUpperCase()} configuration.

REQUIRED CONFIGURATION ELEMENTS:
- Bot name
- Market/instrument
- Trade type (rise_fall, higher_lower, touch_no_touch, in_out, asians, digits_even, digits_odd, digits_over, digits_under)
- Direction (CALL, PUT, or both)
- Duration and unit (ticks, seconds, minutes, hours)
- Stake amount and mode (fixed, percent, martingale, score_scaled)
- Entry conditions (indicators, operators, values)
- Risk management parameters (max consecutive losses, daily loss limits, cooldowns)
- Exit conditions if applicable

${format === 'json' ? `JSON OUTPUT FORMAT:
The output must be valid JSON matching this structure:
{
  "name": "string",
  "market": "string", 
  "tradeType": "string",
  "direction": "string",
  "durationUnit": "string",
  "duration": number,
  "stake": number,
  "stakeMode": "string",
  "purchaseConditions": [
    {
      "id": "string",
      "indicator": "string",
      "period": number,
      "operator": "string", 
      "value": number,
      "logic": "string"
    }
  ],
  "maxConsecLosses": number,
  "dailyLossLimit": number,
  "cooldownMinutes": number,
  "sellConditions": [],
  "maxTradesPerDay": number,
  "enableDailyLoss": boolean,
  "enableTakeProfit": boolean,
  "takeProfitAmount": number
}` : `XML OUTPUT FORMAT:
The output must be valid XML with proper nesting and attributes:
<bot name="string">
  <market>string</market>
  <tradeType>string</tradeType>
  <direction>string</direction>
  <duration unit="string">number</duration>
  <stake mode="string">number</stake>
  <purchaseConditions>
    <condition id="string" indicator="string" period="number" operator="string" value="number" logic="string"/>
  </purchaseConditions>
  <riskManagement>
    <maxConsecLosses>number</maxConsecLosses>
    <dailyLossLimit>number</dailyLossLimit>
    <cooldownMinutes>number</cooldownMinutes>
    <maxTradesPerDay>number</maxTradesPerDay>
  </riskManagement>
  <exitConditions/>
</bot>`}

RESPONSE GUIDELINES:
- Start your response by indicating if you need more information or if you're ready to generate the configuration
- If asking questions, number them clearly and wait for answers
- When generating configuration, provide ONLY the ${format.toUpperCase()} code block
- Make the configuration production-ready and valid`;
  };

  const callOpenRouterAPI = async (messages: Message[], format: 'json' | 'xml') => {
    const systemPrompt = generateSystemPrompt(format);
    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.reasoning_details && { reasoning_details: m.reasoning_details })
      }))
    ];

    // Try multiple models in case one fails
    const models = [
      "qwen/qwen-2.5-7b-instruct",
      "meta-llama/llama-3.1-8b-instruct",
      "google/gemma-2-9b-it:free",
      "microsoft/phi-3-medium-128k-instruct:free"
    ];

    for (const model of models) {
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": window.location.href,
            "X-Title": "APEX Trading Bot Builder"
          },
          body: JSON.stringify({
            "model": model,
            "messages": apiMessages,
            "temperature": 0.7,
            "max_tokens": 2000
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.warn(`Model ${model} failed: ${response.status} - ${errorText}`);
          continue; // Try next model
        }

        const result = await response.json();
        const assistantMessage = result.choices[0].message;
        
        return {
          content: assistantMessage.content,
          reasoning_details: assistantMessage.reasoning_details
        };
      } catch (err) {
        console.warn(`Error with model ${model}:`, err);
        continue; // Try next model
      }
    }

    throw new Error('All AI models failed. Please check your API key and try again.');
  };

  const extractConfigFromResponse = (response: string, format: 'json' | 'xml'): string | null => {
    if (format === 'json') {
      // Try to extract JSON from code blocks or direct JSON
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || 
                       response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const jsonStr = jsonMatch[1] || jsonMatch[0];
          JSON.parse(jsonStr); // Validate it's valid JSON
          return jsonStr;
        } catch {
          return null;
        }
      }
    } else {
      // Try to extract XML from code blocks or direct XML
      const xmlMatch = response.match(/```(?:xml)?\s*([\s\S]*?)\s*```/) ||
                      response.match(/<bot[\s\S]*<\/bot>/);
      if (xmlMatch) {
        return xmlMatch[1] || xmlMatch[0];
      }
    }
    return null;
  };

  const isClarificationRequest = (response: string): boolean => {
    const clarificationKeywords = ['need more information', 'clarify', 'please specify', 'what', 'which', 'how much', 'question', 'unclear'];
    return clarificationKeywords.some(keyword => 
      response.toLowerCase().includes(keyword)
    ) && (response.includes('?') || response.includes('please'));
  };

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;
    
    if (!OPENROUTER_API_KEY) {
      setError('OpenRouter API key is missing. Please set the OPENROUTER_API_KEY environment variable.');
      return;
    }

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
      timestamp: Date.now()
    };

    setInput('');
    setIsLoading(true);
    setError('');

    try {
      const aiResponse = await callOpenRouterAPI(
        [...conversation.messages, userMessage],
        selectedFormat
      );

      const assistantMessage: Message = {
        role: 'assistant',
        content: aiResponse.content,
        reasoning_details: aiResponse.reasoning_details,
        timestamp: Date.now()
      };

      const needsClarification = isClarificationRequest(aiResponse.content);
      const extractedConfig = extractConfigFromResponse(aiResponse.content, selectedFormat);

      setConversation(prev => ({
        ...prev,
        messages: [...prev.messages, userMessage, assistantMessage],
        isComplete: !needsClarification && extractedConfig !== null,
        generatedConfig: extractedConfig,
        configFormat: selectedFormat,
        needsClarification
      }));

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setConversation({
      messages: [],
      isComplete: false,
      generatedConfig: null,
      configFormat: null,
      needsClarification: false,
    });
    setError('');
    localStorage.removeItem('ai_bot_conversation');
  };

  const handleCopyConfig = () => {
    if (conversation.generatedConfig) {
      navigator.clipboard.writeText(conversation.generatedConfig);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const handleDownloadConfig = () => {
    if (conversation.generatedConfig) {
      const blob = new Blob([conversation.generatedConfig], { 
        type: conversation.configFormat === 'json' ? 'application/json' : 'application/xml' 
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bot-config.${conversation.configFormat}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleImportToBotBuilder = () => {
    if (conversation.generatedConfig) {
      // Store in localStorage for the bot builder to pick up
      localStorage.setItem('ai_generated_bot_config', conversation.generatedConfig);
      localStorage.setItem('ai_generated_config_format', conversation.configFormat || 'json');
      
      setImportSuccess(true);
      setTimeout(() => setImportSuccess(false), 2000);
      
      // Navigate to bot builder page
      window.location.hash = '#builder';
      // Force page reload to ensure the bot builder picks up the localStorage data
      setTimeout(() => {
        window.location.reload();
      }, 100);
    }
  };

  return (
    <div className="ai-bot-builder">
      <div className="panel ai-builder-header">
        <div className="panel-title">
          <div>
            <span className="eyebrow">AI-Powered</span>
            <h2><Sparkles size={18} /> Bot Builder</h2>
          </div>
          <div className="format-selector">
            <button 
              className={selectedFormat === 'json' ? 'primary' : 'secondary'}
              onClick={() => setSelectedFormat('json')}
              disabled={conversation.messages.length > 0}
            >
              JSON
            </button>
            <button 
              className={selectedFormat === 'xml' ? 'primary' : 'secondary'}
              onClick={() => setSelectedFormat('xml')}
              disabled={conversation.messages.length > 0}
            >
              XML
            </button>
          </div>
        </div>
        <p className="muted">
          Describe your trading strategy in plain English. AI will convert it to a structured bot configuration.
          If more details are needed, AI will ask clarifying questions.
        </p>
      </div>

      {!OPENROUTER_API_KEY && (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>OpenRouter API key is missing. Please set the OPENROUTER_API_KEY environment variable.</span>
        </div>
      )}

      {error && (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

      <div className="ai-conversation-container">
        <div className="messages-area">
          {conversation.messages.length === 0 && (
            <div className="welcome-message">
              <MessageSquare size={48} />
              <h3>Start Building Your Bot</h3>
              <p>Describe your trading strategy and I'll help you create a bot configuration.</p>
              <div className="example-prompts">
                <p className="muted">Try something like:</p>
                <div className="example-chip" onClick={() => setInput("Create a bot that trades Rise/Fall on Volatility 75 Index when RSI is below 30 for oversold conditions, with 5 tick duration and $5 fixed stake")}>
                  "Create a bot that trades Rise/Fall on Volatility 75 Index when RSI is below 30..."
                </div>
                <div className="example-chip" onClick={() => setInput("I want a trend-following bot using EMA crossovers on Volatility 100 Index with martingale stake management")}>
                  "I want a trend-following bot using EMA crossovers..."
                </div>
              </div>
            </div>
          )}

          {conversation.messages.map((message, index) => (
            <div 
              key={index} 
              className={`message ${message.role === 'user' ? 'user-message' : 'assistant-message'}`}
            >
              <div className="message-content">
                <div className="message-text"
                  dangerouslySetInnerHTML={{ __html: parseMarkdown(message.content) }}
                />
              </div>
              {message.timestamp && (
                <div className="message-time">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="message assistant-message loading">
              <div className="message-content">
                <div className="message-text">
                  <Loader2 size={16} className="spinner" />
                  <span>AI is thinking...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {conversation.isComplete && conversation.generatedConfig && (
          <div className="generated-config-panel">
            <div className="config-header">
              <div>
                <span className="eyebrow">Generated Configuration</span>
                <h3><CheckCircle2 size={16} /> Ready to Use</h3>
              </div>
              <div className="config-actions">
                <button 
                  className="secondary" 
                  onClick={handleCopyConfig} 
                  title="Copy to clipboard"
                  style={{ color: copySuccess ? 'var(--success)' : '' }}
                >
                  {copySuccess ? <CheckCircle2 size={16} /> : <Copy size={16} />}
                </button>
                <button className="secondary" onClick={handleDownloadConfig} title="Download file">
                  <Download size={16} />
                </button>
                <button 
                  className="primary" 
                  onClick={handleImportToBotBuilder}
                  disabled={importSuccess}
                >
                  {importSuccess ? <CheckCircle2 size={16} /> : <ChevronRight size={16} />} 
                  {importSuccess ? 'Imported!' : 'Import to Bot Builder'}
                </button>
              </div>
            </div>
            <div className="config-preview">
              <pre><code>{conversation.generatedConfig}</code></pre>
            </div>
          </div>
        )}

        <div className="input-area">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder={
              conversation.needsClarification 
                ? "Please provide the requested information..." 
                : "Describe your trading strategy..."
            }
            disabled={isLoading || conversation.isComplete}
            rows={3}
          />
          <div className="input-actions">
            {conversation.messages.length > 0 && !conversation.isComplete && (
              <button className="secondary" onClick={handleReset} disabled={isLoading}>
                <RefreshCw size={16} /> Reset
              </button>
            )}
            <button 
              className="primary" 
              onClick={handleSendMessage}
              disabled={!input.trim() || isLoading || conversation.isComplete || !OPENROUTER_API_KEY}
            >
              {isLoading ? <Loader2 size={16} className="spinner" /> : <Send size={16} />}
              {isLoading ? 'Sending...' : conversation.needsClarification ? 'Answer' : 'Generate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}