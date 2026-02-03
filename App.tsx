
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { 
  analyzeRecruitment, 
  generateAudio, 
  decode, 
  decodeAudioData, 
  createPcmBlob 
} from './services/geminiService';
import { RecruitmentAnalysis, JDHistory } from './types';
import { 
  Briefcase, 
  FileText, 
  Search, 
  AlertCircle, 
  CheckCircle2, 
  Mic2, 
  Download,
  Loader2,
  XCircle,
  PlayCircle,
  Volume2,
  Square,
  Waves,
  FileUp,
  X,
  Building2,
  Percent,
  History,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  BookOpen,
  LayoutDashboard,
  Award,
  PlusCircle,
  ArrowRight,
  Info,
  ShieldAlert,
  Fingerprint
} from 'lucide-react';
// @ts-ignore
import mammoth from 'mammoth';
// @ts-ignore
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;

// --- Components ---

const ResumeRenderer: React.FC<{ markdown: string }> = ({ markdown }) => {
  if (!markdown) return <div className="text-slate-400 italic">No benchmark generated.</div>;
  
  const lines = markdown.split('\n');
  const rendered: React.ReactNode[] = [];
  let currentList: React.ReactNode[] = [];

  const flushList = (key: number) => {
    if (currentList.length > 0) {
      rendered.push(<ul key={`list-${key}`}>{currentList}</ul>);
      currentList = [];
    }
  };

  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) return;

    const parseBold = (text: string) => {
      if (!text.includes('**')) return text;
      return text.split('**').map((p, idx) => idx % 2 === 1 ? <strong key={idx}>{p}</strong> : p);
    };

    if (t.startsWith('# ')) {
      flushList(i);
      rendered.push(<h1 key={i}>{parseBold(t.substring(2))}</h1>);
    } else if (i === 1 && rendered.length === 1 && !t.startsWith('##')) {
      rendered.push(<div key="contact" className="contact-info">{parseBold(t)}</div>);
    } else if (t.startsWith('## ')) {
      flushList(i);
      rendered.push(<h2 key={i}>{parseBold(t.substring(3))}</h2>);
    } else if (t.startsWith('* ') || t.startsWith('- ')) {
      currentList.push(<li key={i}>{parseBold(t.substring(2))}</li>);
    } else {
      flushList(i);
      rendered.push(<p key={i}>{parseBold(t)}</p>);
    }
  });
  flushList(lines.length);

  return <div className="resume-preview">{rendered}</div>;
};

// --- Main App ---

export default function App() {
  const [history, setHistory] = useState<JDHistory[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  
  const [jd, setJd] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [resumeFileName, setResumeFileName] = useState('');
  const [isParsingResume, setIsParsingResume] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'strategy' | 'resume' | 'glossary'>('strategy');

  const [isLiveActive, setIsLiveActive] = useState(false);
  const [isLiveConnecting, setIsLiveConnecting] = useState(false);
  
  const liveSessionRef = useRef<any>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const currentAnalysis = history.find(h => h.id === currentId)?.analysis;

  const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsingResume(true);
    setError(null);
    setResumeFileName(file.name);

    try {
      let text = '';
      const extension = file.name.split('.').pop()?.toLowerCase();

      if (extension === 'pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          fullText += content.items.map((item: any) => item.str).join(' ') + '\n';
        }
        text = fullText;
      } else if (extension === 'docx') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
      } else if (extension === 'doc') {
        setError("Old .doc format is not fully supported in-browser. Please use .docx or .pdf for best results, or copy and paste the text.");
        setResumeFileName('');
        setIsParsingResume(false);
        return;
      } else {
        throw new Error("Unsupported file format. Use .pdf or .docx.");
      }

      if (!text.trim()) throw new Error("Extraction failed. The file might be empty or image-based.");
      setResumeText(text);
    } catch (err: any) {
      setError(err.message || "Failed to parse resume.");
      setResumeFileName('');
    } finally {
      setIsParsingResume(false);
    }
  };

  const handleAnalysis = async () => {
    if (!jd.trim()) { setError('Please provide a job description.'); return; }

    setIsAnalyzing(true);
    setError(null);
    setAudioUrl(null);
    stopLiveChat();

    try {
      const result = await analyzeRecruitment(jd, resumeText || undefined);
      const newHistoryItem: JDHistory = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        title: result.title || "Untitled Requirement",
        analysis: result
      };
      setHistory(prev => [newHistoryItem, ...prev]);
      setCurrentId(newHistoryItem.id);
      
      const url = await generateAudio(result.audioScript);
      setAudioUrl(url);
      setActiveTab('strategy');
    } catch (err: any) {
      console.error(err);
      setError('Analysis failed. This might be due to a complex JD or API limits. Try again with a shorter JD.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const startLiveChat = async () => {
    if (!currentAnalysis) return;
    const hasKey = await (window as any).aistudio.hasSelectedApiKey();
    if (!hasKey) await (window as any).aistudio.openSelectKey();

    setIsLiveConnecting(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsLiveActive(true);
            setIsLiveConnecting(false);
            const source = inputAudioContextRef.current!.createMediaStreamSource(mediaStreamRef.current!);
            scriptProcessorRef.current = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current.onaudioprocess = (e) => {
              const pcmBlob = createPcmBlob(e.inputBuffer.getChannelData(0));
              sessionPromise.then(s => s.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessorRef.current);
            scriptProcessorRef.current.connect(inputAudioContextRef.current!.destination);
          },
          onmessage: async (m: LiveServerMessage) => {
            const base64 = m.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64 && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buf = await decodeAudioData(decode(base64), ctx, 24000, 1);
              const src = ctx.createBufferSource();
              src.buffer = buf;
              src.connect(ctx.destination);
              src.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buf.duration;
              audioSourcesRef.current.add(src);
            }
            if (m.serverContent?.interrupted) {
              audioSourcesRef.current.forEach(s => { try { s.stop(); } catch(e){} });
              audioSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: `You are a Recruitment Lead for ${currentAnalysis.title}. Discuss the strategy.`,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } }
        }
      });
      liveSessionRef.current = await sessionPromise;
    } catch (e) {
      setError("Live chat failed.");
      stopLiveChat();
    }
  };

  const stopLiveChat = () => {
    liveSessionRef.current?.close();
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    inputAudioContextRef.current?.close();
    outputAudioContextRef.current?.close();
    audioSourcesRef.current.forEach(s => { try { s.stop(); } catch(e){} });
    setIsLiveActive(false);
    setIsLiveConnecting(false);
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      
      {/* Sidebar: History */}
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col no-print shrink-0">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <div className="p-2 bg-indigo-600 rounded-lg text-white">
            <Briefcase size={20} />
          </div>
          <h1 className="font-black text-slate-900 tracking-tight">RecruitMaster</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <button 
            onClick={() => { setCurrentId(null); setJd(''); setResumeText(''); setResumeFileName(''); }}
            className={`w-full flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-all ${!currentId ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <PlusCircle size={18} /> New Requirement
          </button>
          <div className="pt-4 pb-2 text-[10px] font-black text-slate-400 uppercase tracking-widest pl-4">History</div>
          {history.map(item => (
            <button 
              key={item.id}
              onClick={() => setCurrentId(item.id)}
              className={`w-full text-left px-4 py-3 rounded-xl transition-all border ${currentId === item.id ? 'bg-white border-indigo-200 shadow-sm' : 'border-transparent hover:bg-slate-50'}`}
            >
              <div className="font-bold text-slate-900 text-sm truncate">{item.title}</div>
              <div className="text-[10px] text-slate-400">{new Date(item.timestamp).toLocaleDateString()}</div>
            </button>
          ))}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto relative p-8">
        {!currentId && !isAnalyzing ? (
          <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4">
            <header className="text-center space-y-2">
              <h2 className="text-3xl font-black text-slate-900">Analyze New Requirement</h2>
              <p className="text-slate-500">Paste your JD and optionally a resume for deep evaluation.</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-black uppercase text-slate-400 tracking-widest pl-1 flex items-center gap-2"><FileText size={14}/> Job Description</label>
                <textarea 
                  className="w-full h-80 p-6 rounded-[2rem] border border-slate-200 bg-white shadow-sm focus:ring-4 focus:ring-indigo-100 outline-none resize-none text-sm leading-relaxed"
                  placeholder="Paste job description here..."
                  value={jd}
                  onChange={e => setJd(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase text-slate-400 tracking-widest pl-1 flex items-center gap-2"><Search size={14}/> Benchmark Candidate (Optional)</label>
                <div className="h-80 w-full rounded-[2.5rem] border-2 border-dashed border-slate-200 bg-white flex flex-col items-center justify-center p-8 transition-all relative overflow-hidden">
                  {!resumeFileName ? (
                    <label className="cursor-pointer group flex flex-col items-center gap-4 text-center">
                      <div className="p-5 bg-indigo-50 rounded-full group-hover:scale-110 transition-transform"><FileUp size={40} className="text-indigo-600"/></div>
                      <div>
                        <span className="text-sm font-bold text-indigo-600">Upload PDF/DOCX</span>
                        <p className="text-[10px] text-slate-400 mt-1">Gaps and Stints will be analyzed</p>
                      </div>
                      <input type="file" className="hidden" accept=".pdf,.docx,.doc" onChange={handleResumeUpload} />
                    </label>
                  ) : (
                    <div className="flex flex-col items-center gap-4 animate-in zoom-in duration-300">
                      <div className="p-5 bg-green-50 rounded-full"><CheckCircle2 size={40} className="text-green-600"/></div>
                      <div className="text-center">
                        <p className="text-sm font-bold truncate max-w-[200px]">{resumeFileName}</p>
                        <button onClick={() => { setResumeFileName(''); setResumeText(''); }} className="text-xs text-red-500 font-bold mt-2">Remove</button>
                      </div>
                    </div>
                  )}
                  {isParsingResume && (
                    <div className="absolute inset-0 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center">
                      <Loader2 className="animate-spin text-indigo-600 mb-2" size={32}/>
                      <span className="text-sm font-bold">Parsing...</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-100 text-red-700 rounded-2xl flex items-center gap-3 text-sm font-medium">
                <AlertCircle size={18}/> {error}
              </div>
            )}

            <button 
              onClick={handleAnalysis}
              disabled={isAnalyzing || !jd.trim()}
              className="w-full py-5 bg-slate-900 hover:bg-black text-white rounded-[2rem] font-black text-lg shadow-xl hover:shadow-2xl transition-all transform hover:-translate-y-1 flex items-center justify-center gap-3 disabled:bg-slate-200"
            >
              Analyze Requirement <ArrowRight size={20}/>
            </button>
          </div>
        ) : isAnalyzing ? (
          <div className="h-full flex flex-col items-center justify-center space-y-6">
            <div className="relative">
              <div className="w-24 h-24 border-8 border-slate-100 border-t-indigo-600 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center"><Briefcase size={32} className="text-indigo-600"/></div>
            </div>
            <div className="text-center space-y-1">
              <h3 className="text-xl font-black">AI Vetting in Progress</h3>
              <p className="text-slate-500 text-sm italic">Analyzing gaps, stints, and building benchmark profile...</p>
            </div>
          </div>
        ) : (
          /* Results View */
          <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
            
            {/* Control Header */}
            <header className="flex flex-wrap items-center justify-between gap-6 bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm no-print sticky top-0 z-40 backdrop-blur-md bg-white/90">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="px-3 py-0.5 bg-indigo-600 text-white text-[10px] font-black rounded uppercase tracking-widest">Active Report</span>
                  <span className="text-[10px] font-mono text-slate-400 font-bold">ID: {currentId}</span>
                </div>
                <h2 className="text-2xl font-black text-slate-900 tracking-tight">{currentAnalysis?.title}</h2>
              </div>
              <div className="flex items-center gap-3">
                {audioUrl && (
                  <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-2xl border border-slate-200">
                    <audio src={audioUrl} controls className="h-8 w-40" />
                    <button onClick={() => { const l = document.createElement('a'); l.href = audioUrl; l.download = "briefing.mp3"; l.click(); }} className="p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition shadow-md"><Download size={16}/></button>
                  </div>
                )}
                {!isLiveActive ? (
                  <button onClick={startLiveChat} disabled={isLiveConnecting} className="px-6 py-2.5 bg-slate-900 text-white rounded-2xl text-xs font-bold hover:bg-black transition flex items-center gap-2">
                    {isLiveConnecting ? <Loader2 className="animate-spin" size={14}/> : <Mic2 size={14}/>} Start Audio Vetting
                  </button>
                ) : (
                  <button onClick={stopLiveChat} className="px-6 py-2.5 bg-red-600 text-white rounded-2xl text-xs font-bold animate-pulse flex items-center gap-2">
                    <Square size={14} fill="currentColor"/> Stop Chat
                  </button>
                )}
              </div>
            </header>

            {/* Navigation Tabs */}
            <nav className="flex gap-2 no-print">
              {[
                { id: 'strategy', label: 'Strategy Board', icon: LayoutDashboard },
                { id: 'resume', label: 'Benchmark CV', icon: Award },
                { id: 'glossary', label: 'Tech Knowledge', icon: BookOpen }
              ].map(tab => (
                <button 
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-xs font-bold transition-all ${activeTab === tab.id ? 'bg-white text-indigo-700 shadow-sm border border-indigo-100' : 'text-slate-400 hover:text-slate-600 hover:bg-white/50'}`}
                >
                  <tab.icon size={16}/> {tab.label}
                </button>
              ))}
            </nav>

            {/* Tab Contents */}
            {activeTab === 'strategy' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Left: Summary & Preferences */}
                <div className="md:col-span-2 space-y-8">
                  <section className="bg-white rounded-[2rem] p-10 shadow-sm border border-slate-100">
                    <h3 className="text-xl font-black mb-6 flex items-center gap-3"><Info className="text-indigo-600"/> Recruitment Essence</h3>
                    <p className="text-slate-600 text-lg font-light leading-relaxed border-l-4 border-indigo-200 pl-8 italic">"{currentAnalysis?.jobSummary}"</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-10">
                      <div>
                        <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-4">Non-Negotiables</h4>
                        <ul className="space-y-3">
                          {currentAnalysis?.priorityRequirements.map((r, i) => (
                            <li key={i} className="flex gap-3 text-sm font-bold text-slate-800"><CheckCircle2 className="text-green-500 shrink-0" size={18}/> {r}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-4">Submission Playbook</h4>
                        <ul className="space-y-3">
                          {currentAnalysis?.submissionTips?.map((t, i) => (
                            <li key={i} className="flex gap-3 text-sm font-medium text-slate-600 italic">
                              <span className="text-indigo-600 font-black">#</span> {t}
                            </li>
                          )) || <li className="text-slate-400 text-xs italic">N/A</li>}
                        </ul>
                      </div>
                    </div>
                  </section>

                  {/* Sourcing Taxonomy */}
                  <section className="bg-slate-900 rounded-[2rem] p-10 text-white shadow-xl">
                    <h3 className="text-xl font-black mb-8 tracking-tight">Sourcing Architecture</h3>
                    <div className="space-y-8">
                      <div>
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Master Sourcing String</h4>
                        <div className="bg-slate-800 p-6 rounded-2xl font-mono text-[11px] text-indigo-300 break-words border border-slate-700">
                          {currentAnalysis?.keywords?.booleanStrings?.[0] || 'Generating sourcing strategy...'}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-8">
                        <div>
                          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Keywords (Primary)</h4>
                          <div className="flex flex-wrap gap-2">
                            {currentAnalysis?.keywords?.primary?.map((k, i) => (
                              <span key={i} className="px-3 py-1 bg-slate-800 text-indigo-200 rounded-lg text-[10px] font-bold border border-slate-700">{k}</span>
                            )) || <span className="text-slate-500 text-[10px] italic">Extracting...</span>}
                          </div>
                        </div>
                        <div>
                          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Target Companies</h4>
                          <div className="flex flex-wrap gap-2">
                            {currentAnalysis?.targetCompanies?.map((c, i) => (
                              <span key={i} className="px-3 py-1 bg-slate-800 text-slate-400 rounded-lg text-[10px] font-bold border border-slate-700">{c}</span>
                            )) || <span className="text-slate-500 text-[10px] italic">Extracting...</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>

                {/* Right: Candidate Analysis if exists */}
                <div className="space-y-8">
                  {currentAnalysis?.candidateAnalysis ? (
                    <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100 space-y-10">
                      <div className="text-center">
                        <div className="inline-flex flex-col items-center justify-center w-32 h-32 rounded-full border-4 border-indigo-50 bg-indigo-50/30 mb-4">
                          <span className="text-4xl font-black text-indigo-700">{currentAnalysis.candidateAnalysis.overallMatchPercentage}%</span>
                          <span className="text-[8px] font-black uppercase text-indigo-400 tracking-widest">Match Score</span>
                        </div>
                      </div>

                      {/* ATS Integrity Audit Section */}
                      {currentAnalysis.candidateAnalysis.keywordStuffingAnalysis && (
                        <div className="p-6 bg-slate-900 rounded-3xl border border-slate-700 shadow-xl relative overflow-hidden group">
                          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform"><ShieldAlert size={60} className="text-white"/></div>
                          <h4 className="text-[10px] font-black uppercase text-indigo-400 tracking-[0.2em] mb-4 flex items-center gap-2">
                            <Fingerprint size={12}/> ATS Integrity Audit
                          </h4>
                          <div className="space-y-4 relative z-10">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-slate-400 font-bold">Risk Level</span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${
                                currentAnalysis.candidateAnalysis.keywordStuffingAnalysis.riskLevel === 'Low' ? 'bg-green-500/20 text-green-400' : 
                                currentAnalysis.candidateAnalysis.keywordStuffingAnalysis.riskLevel === 'Elevated' ? 'bg-orange-500/20 text-orange-400' : 'bg-red-500/20 text-red-400'
                              }`}>
                                {currentAnalysis.candidateAnalysis.keywordStuffingAnalysis.riskLevel}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-300 leading-relaxed font-medium">
                              {currentAnalysis.candidateAnalysis.keywordStuffingAnalysis.findings}
                            </p>
                            {currentAnalysis.candidateAnalysis.keywordStuffingAnalysis.detectedArtificialClusters?.length > 0 && (
                              <div className="pt-2 border-t border-slate-800">
                                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2">Flagged Terms</span>
                                <div className="flex flex-wrap gap-1.5">
                                  {currentAnalysis.candidateAnalysis.keywordStuffingAnalysis.detectedArtificialClusters.map((term, i) => (
                                    <span key={i} className="px-2 py-1 bg-red-900/30 text-red-300 rounded text-[9px] font-mono border border-red-800/50">{term}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="space-y-6">
                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Overall Authenticity</span>
                          <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                            currentAnalysis.candidateAnalysis.authenticityScore === 'High' ? 'bg-green-100 text-green-700' : 
                            currentAnalysis.candidateAnalysis.authenticityScore === 'Caution' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'
                          }`}>{currentAnalysis.candidateAnalysis.authenticityScore}</span>
                        </div>
                        <div>
                          <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-3 flex items-center gap-2"><History size={12}/> Red Flags & Gaps</h4>
                          <div className="space-y-2">
                            {currentAnalysis.candidateAnalysis.employmentGaps?.map((g, i) => <div key={i} className="text-xs font-bold text-red-600 bg-red-50 p-2 rounded-lg border border-red-100">GAP: {g}</div>)}
                            {currentAnalysis.candidateAnalysis.shortTermAssignments?.map((s, i) => <div key={i} className="text-xs font-bold text-orange-600 bg-orange-50 p-2 rounded-lg border border-orange-100">STINT: {s}</div>)}
                            {(!currentAnalysis.candidateAnalysis.employmentGaps?.length && !currentAnalysis.candidateAnalysis.shortTermAssignments?.length) && <p className="text-xs text-slate-400 italic">No stability issues identified.</p>}
                          </div>
                        </div>
                        <div className="p-5 bg-indigo-50 rounded-[2rem] border border-indigo-100">
                          <h4 className="text-xs font-black uppercase text-indigo-700 tracking-widest mb-4">Screening Questions</h4>
                          <ul className="space-y-3">
                            {currentAnalysis.candidateAnalysis.recruiterQuestions?.map((q, i) => <li key={i} className="text-xs font-bold text-indigo-900 leading-snug">"{q}"</li>) || <li className="text-xs italic text-slate-400">N/A</li>}
                          </ul>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white rounded-[2rem] p-10 shadow-sm border border-slate-100 border-dashed flex flex-col items-center justify-center text-center opacity-60 h-full min-h-[400px]">
                      <Search size={48} className="text-slate-300 mb-4"/>
                      <p className="text-sm font-bold text-slate-400">No Candidate Analyzed</p>
                      <p className="text-[10px] text-slate-400 mt-2 max-w-[200px]">Analyze with a resume next time to see Gaps, Stints, and Authenticity checks.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Benchmark Resume Tab */}
            {activeTab === 'resume' && (
              <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex items-center justify-between no-print px-4">
                  <div>
                    <h3 className="text-xl font-black">Benchmark Candidate Profile</h3>
                    <p className="text-xs text-slate-500 font-medium tracking-widest uppercase">Ideal candidate blueprint for this requirement</p>
                  </div>
                  <button onClick={() => window.print()} className="bg-white border border-slate-200 text-slate-900 px-6 py-2 rounded-2xl text-xs font-bold hover:bg-slate-50 shadow-sm transition flex items-center gap-2">
                    <Download size={14}/> Print Benchmark PDF
                  </button>
                </div>
                <div className="bg-white p-20 shadow-2xl border border-slate-100 mx-auto w-full min-h-[1100px] resume-container rounded-sm">
                  {currentAnalysis && <ResumeRenderer markdown={currentAnalysis.sampleResume} />}
                </div>
              </div>
            )}

            {/* Tech Glossary Tab */}
            {activeTab === 'glossary' && (
              <div className="space-y-8 animate-in zoom-in duration-300">
                <header className="bg-indigo-600 rounded-[2rem] p-10 text-white shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-10 opacity-10"><BookOpen size={160}/></div>
                  <div className="relative z-10 space-y-4">
                    <h3 className="text-3xl font-black">Technical Knowledge Base</h3>
                    <p className="text-indigo-100 max-w-2xl leading-relaxed font-medium">Equip yourself with the technical definitions and "Why It Matters" context for every complex skill found in this requirement.</p>
                  </div>
                </header>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {currentAnalysis?.techGlossary?.map((item, i) => (
                    <div key={i} className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100 group hover:border-indigo-200 transition-colors">
                      <h4 className="text-indigo-600 font-black mb-3 text-lg group-hover:scale-105 transition-transform origin-left">{item.term}</h4>
                      <p className="text-slate-600 text-sm leading-relaxed font-medium">{item.explanation}</p>
                    </div>
                  )) || <div className="text-slate-400 italic">No glossary entries found.</div>}
                </div>
              </div>
            )}

          </div>
        )}

        {/* Floating Active Indicator */}
        {isLiveActive && (
          <div className="fixed bottom-10 right-10 z-50 animate-bounce">
            <div className="bg-slate-900 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 border border-indigo-500">
              <div className="flex gap-0.5">
                {[1,2,3,4].map(i => <div key={i} className="w-1 bg-indigo-400 rounded-full animate-pulse" style={{ height: `${Math.random()*20 + 4}px`, animationDelay: `${i*100}ms` }} />)}
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest">Vetting Engine Live</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
