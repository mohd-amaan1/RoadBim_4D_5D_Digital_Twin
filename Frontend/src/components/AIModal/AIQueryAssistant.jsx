import React, { useState } from 'react';
import { useRoadData } from '../../context/RoadDataContext';
import { Bot, Send, Sparkles, X, Lightbulb, ShieldAlert, ArrowRight } from 'lucide-react';

export default function AIQueryAssistant() {
  const { isAiAssistantOpen, setIsAiAssistantOpen } = useRoadData();
  const [messages, setMessages] = useState([
    {
      sender: 'ai',
      text: 'Hello! I am your AI Infrastructure Assistant. Ask me anything about the 100 KM road progress, layer bottlenecks, delays, or cost performance.'
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  if (!isAiAssistantOpen) return null;

  const sampleQueries = [
    "Show me all delayed sections in Layer 4 (DBM)",
    "What is our projected 100 KM completion date?",
    "Generate cost variance summary for executive director"
  ];

  const handleSend = (textToSend) => {
    const query = textToSend || input;
    if (!query.trim()) return;

    setMessages(prev => [...prev, { sender: 'user', text: query }]);
    setInput('');
    setIsTyping(true);

    // Call Backend API or simulated intelligent response
    setTimeout(() => {
      let aiReply = "100 KM Highway Corridor Digital Twin is performing at SPI 0.96 and CPI 1.04. Overall completion is 62.4% with Subgrade 100% complete.";
      let action = "";

      const q = query.toLowerCase();
      if (q.includes("delay") || q.includes("dbm")) {
        aiReply = "Found 8 delayed sections in DBM layer (KM 040 to KM 048). Delay cause: Bitumen batching plant breakdown and aggregate transport backlog.";
        action = "Recommended Action: Shift 2 extra asphalt paver units from Section 20 to clear KM 040 bottleneck by August 18.";
      } else if (q.includes("completion") || q.includes("date")) {
        aiReply = "At current velocity of 2.4 KM/week, full 100 KM 5-layer handover is estimated for August 28, 2026 (12 days ahead of contract milestone).";
      } else if (q.includes("cost") || q.includes("variance")) {
        aiReply = "Total budget spent is $40.8M against $42.5M earned value. Project has a net positive cost variance of +$1.7M (+4.0% savings).";
      }

      setMessages(prev => [...prev, { sender: 'ai', text: aiReply, action: action }]);
      setIsTyping(false);
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="bg-slate-900 border border-purple-500/30 rounded-2xl max-w-xl w-full chat-panel flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/40">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white font-[Outfit]">AI Infrastructure Query Assistant</h3>
              <p className="text-[10px] text-purple-300">Natural Language BIM Data & Delay Analytics</p>
            </div>
          </div>
          <button onClick={() => setIsAiAssistantOpen(false)} className="p-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3 text-xs">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl p-3.5 space-y-2 ${
                msg.sender === 'user' 
                  ? 'bg-cyan-600 text-white rounded-tr-none' 
                  : 'bg-slate-800/90 text-slate-200 border border-slate-700/80 rounded-tl-none'
              }`}>
                <p className="leading-relaxed">{msg.text}</p>
                {msg.action && (
                  <div className="pt-2 border-t border-purple-500/30 text-[11px] text-purple-300 font-medium flex items-start space-x-1.5">
                    <Sparkles className="h-4 w-4 text-purple-400 shrink-0 mt-0.5" />
                    <span>{msg.action}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="text-slate-400 text-xs italic flex items-center space-x-2">
              <Sparkles className="h-4 w-4 animate-spin text-purple-400" />
              <span>AI is analyzing 100 KM SQL database...</span>
            </div>
          )}
        </div>

        {/* Suggested Quick Queries */}
        <div className="px-4 py-2 bg-slate-950/60 border-t border-slate-800 flex flex-wrap gap-1.5">
          {sampleQueries.map((sq, i) => (
            <button
              key={i}
              onClick={() => handleSend(sq)}
              className="text-[10px] bg-slate-800/80 hover:bg-purple-900/40 text-slate-300 hover:text-purple-200 border border-slate-700 rounded-lg px-2.5 py-1 transition-all"
            >
              {sq}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <div className="p-3 bg-slate-950 border-t border-slate-800 flex items-center space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask AI about road progress, delayed layers, or cost variance..."
            className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
          />
          <button
            onClick={() => handleSend()}
            className="p-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition-all"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
