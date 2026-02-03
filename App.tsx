
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

// Robust worker configuration
const PDFJS_VERSION = '4.0.379';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;

// --- Components ---

const ResumeRenderer: React.FC<{ markdown: string }> = ({ markdown }) => {
  if (!markdown) return <div className="text-slate-400 italic py-12 text-center border-2 border-dashed border-slate-100 rounded-3xl">Benchmark profile generating...</div>;
  
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
      } else {
        throw new Error("Only .pdf and .docx files are currently supported for forensic analysis.");
      }

      if (!text.trim()) throw new Error("Document extraction returned empty text. Ensure the file is not just a scanned image.");
      setResumeText(text);
    } catch (err: any) {
      setError(err.message || "Failed to parse document.");
      setResumeFileName('');
    } finally {
      setIsParsingResume(false);
    }
  };

  const handleAnalysis = async () => {
    if (!jd.trim()) { setError('A Job Description is required.'); return; }

    setIsAnalyzing(true);
    setError(null);
    setAudioUrl(null);
    stopLiveChat();

    try {
      const result = await analyzeRecruitment(jd, resumeText || undefined);
      const newHistoryItem: JDHistory = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        title: result.title || "Talent Audit",
        analysis: result
      };
      setHistory(prev => [newHistoryItem, ...prev]);
      setCurrentId(newHistoryItem.id);
      
      const url = await generateAudio(result.audioScript);
      setAudioUrl(url);
      setActiveTab('strategy');
    } catch (err: any) {
      console.error(err);
      setError('Analysis failed. The input might be too long or complex for the current API limits. Try a shorter version.');
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
            const base64 = m.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
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
          systemInstruction: `You are a Recruitment Lead for the following role: ${currentAnalysis.title}. Discuss sourcing strategy, vetting, and forensic candidate audits.`,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } }
        }
      });
      liveSessionRef.current = await sessionPromise;
    } catch (e) {
      setError("Failed to start vetting session.");
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
    <div className="flex h-screen bg-slate-50 overflow-hidden selection:bg-indigo-100">
      
      {/* Sidebar: History */}
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col no-print shrink-0">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <div className="p-2.5 bg-indigo-600 rounded-2xl text-white shadow-lg shadow-indigo-200">
            <Briefcase size={22} />
          </div>
          <h1 className="font-black text-slate-900 tracking-tight text-xl">RecruitMaster</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <button 
            onClick={() => { setCurrentId(null); setJd(''); setResumeText(''); setResumeFileName(''); }}
            className={`w-full flex items-center gap-2 px-4 py-3.5 rounded-2xl text-sm font-bold transition-all ${!currentId ? 'bg-indigo-50 text-indigo-700 shadow-sm border border-indigo-100' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <PlusCircle size={18} /> New Audit
          </button>
          <div className="pt-6 pb-2 text-[10px] font-black text-slate-400 uppercase tracking-widest pl-4">Audit Logs</div>
          {history.map(item => (
            <button 
              key={item.id}
              onClick={() => { setCurrentId(item.id); setActiveTab('strategy'); }}
              className={`w-full text-left px-4 py-3.5 rounded-2xl transition-all border ${currentId === item.id ? 'bg-white border-indigo-200 shadow-sm ring-1 ring-indigo-50' : 'border-transparent hover:bg-slate-50'}`}
            >
              <div className="font-bold text-slate-900 text-sm truncate">{item.title}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">{new Date(item.timestamp).toLocaleDateString()} at {new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
            </button>
          ))}
          {history.length === 0 && <div className="p-4 text-center text-xs text-slate-400 italic">No previous audits found.</div>}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto relative p-8">
        {!currentId && !isAnalyzing ? (
          <div className="max-w-4xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-500">
            <header className="text-center space-y-3">
              <h2 className="text-4xl font-black text-slate-900 tracking-tight">Talent Intelligence Portal</h2>
              <p className="text-slate-500 text-lg">Forensic JD analysis and ATS-integrity candidate auditing.</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-3">
                <label className="text-xs font-black uppercase text-slate-400 tracking-widest pl-1 flex items-center gap-2"><FileText size={14}/> Job Requirement</label>
                <textarea 
                  className="w-full h-96 p-8 rounded-[2.5rem] border border-slate-200 bg-white shadow-xl shadow-slate-200/50 focus:ring-8 focus:ring-indigo-100 outline-none resize-none text-sm leading-relaxed transition-all"
                  placeholder="Paste Job Description for strategic mapping..."
                  value={jd}
                  onChange={e => setJd(e.target.value)}
                />
              </div>
              <div className="space-y-3">
                <label className="text-xs font-black uppercase text-slate-400 tracking-widest pl-1 flex items-center gap-2"><Search size={14}/> Forensic Audit (Optional)</label>
                <div className="h-96 w-full rounded-[3rem] border-3 border-dashed border-slate-200 bg-white flex flex-col items-center justify-center p-10 transition-all relative overflow-hidden group hover:border-indigo-300">
                  {!resumeFileName ? (
                    <label className="cursor-pointer group flex flex-col items-center gap-6 text-center">
                      <div className="p-7 bg-indigo-50 rounded-[2rem] group-hover:scale-110 group-hover:bg-indigo-600 group-hover:text-white transition-all duration-300"><FileUp size={48} className="text-indigo-600 group-hover:text-white"/></div>
                      <div>
                        <span className="text-lg font-black text-slate-800">Drop Resume Here</span>
                        <p className="text-xs text-slate-400 mt-2 font-medium">Detect keyword stuffing & gap patterns</p>
                      </div>
                      <input type="file" className="hidden" accept=".pdf,.docx" onChange={handleResumeUpload} />
                    </label>
                  ) : (
                    <div className="flex flex-col items-center gap-6 animate-in zoom-in duration-300">
                      <div className="p-7 bg-green-50 rounded-[2rem] shadow-lg shadow-green-100"><CheckCircle2 size={48} className="text-green-600"/></div>
                      <div className="text-center">
                        <p className="text-lg font-black text-slate-900 truncate max-w-[250px]">{resumeFileName}</p>
                        <button onClick={() => { setResumeFileName(''); setResumeText(''); }} className="text-xs text-red-500 font-black mt-3 hover:underline">Revoke Document</button>
                      </div>
                    </div>
                  )}
                  {isParsingResume && (
                    <div className="absolute inset-0 bg-white/95 backdrop-blur-md flex flex-col items-center justify-center z-50">
                      <Loader2 className="animate-spin text-indigo-600 mb-4" size={40}/>
                      <span className="text-sm font-black text-indigo-900 tracking-widest uppercase">Extracting Corpus...</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {error && (
              <div className="p-5 bg-red-50 border border-red-100 text-red-700 rounded-3xl flex items-center gap-4 text-sm font-bold animate-in shake duration-300">
                <AlertCircle size={20} className="shrink-0"/> {error}
              </div>
            )}

            <button 
              onClick={handleAnalysis}
              disabled={isAnalyzing || !jd.trim()}
              className="w-full py-6 bg-slate-900 hover:bg-black text-white rounded-[2.5rem] font-black text-xl shadow-2xl hover:shadow-indigo-200 transition-all transform hover:-translate-y-1.5 flex items-center justify-center gap-4 disabled:bg-slate-200 disabled:transform-none"
            >
              Initialize Intelligence Audit <ArrowRight size={24}/>
            </button>
          </div>
        ) : isAnalyzing ? (
          <div className="h-full flex flex-col items-center justify-center space-y-8 animate-pulse">
            <div className="relative">
              <div className="w-32 h-32 border-[12px] border-slate-100 border-t-indigo-600 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center"><Fingerprint size={48} className="text-indigo-600"/></div>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-black tracking-tight">Vetting Engine Online</h3>
              <p className="text-slate-500 text-sm font-medium italic">Performing forensic keyword analysis and tenure verification...</p>
            </div>
          </div>
        ) : (
          /* Results View */
          <div className="max-w-6xl mx-auto space-y-10 animate-in fade-in duration-700">
            
            {/* Control Header */}
            <header className="flex flex-wrap items-center justify-between gap-6 bg-white p-8 rounded-[3rem] border border-slate-100 shadow-2xl no-print sticky top-0 z-40 backdrop-blur-xl bg-white/95">
              <div className="max-w-md">
                <div className="flex items-center gap-3 mb-2">
                  <span className="px-3 py-1 bg-indigo-600 text-white text-[10px] font-black rounded-lg uppercase tracking-widest">Active Audit</span>
                  <span className="text-[10px] font-mono text-slate-400 font-bold">SHA-256: {currentId?.substring(0, 12)}</span>
                </div>
                <h2 className="text-3xl font-black text-slate-900 tracking-tight leading-none">{currentAnalysis?.title}</h2>
              </div>
              <div className="flex items-center gap-4">
                {audioUrl && (
                  <div className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-[1.5rem] border border-slate-200">
                    <audio src={audioUrl} controls className="h-9 w-44" />
                    <button onClick={() => { const l = document.createElement('a'); l.href = audioUrl; l.download = "intelligence_brief.mp3"; l.click(); }} className="p-2.5 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 transition shadow-lg"><Download size={18}/></button>
                  </div>
                )}
                {!isLiveActive ? (
                  <button onClick={startLiveChat} disabled={isLiveConnecting} className="px-8 py-3.5 bg-slate-900 text-white rounded-3xl text-sm font-black hover:bg-black transition-all flex items-center gap-3 shadow-xl hover:shadow-indigo-200">
                    {isLiveConnecting ? <Loader2 className="animate-spin" size={18}/> : <Mic2 size={18}/>} RecruitVoice™ Live
                  </button>
                ) : (
                  <button onClick={stopLiveChat} className="px-8 py-3.5 bg-red-600 text-white rounded-3xl text-sm font-black animate-pulse flex items-center gap-3 shadow-xl shadow-red-200">
                    <Square size={18} fill="currentColor"/> End Session
                  </button>
                )}
              </div>
            </header>

            {/* Navigation Tabs */}
            <nav className="flex gap-3 no-print p-1.5 bg-white rounded-3xl border border-slate-100 w-fit mx-auto shadow-sm">
              {[
                { id: 'strategy', label: 'Intelligence Board', icon: LayoutDashboard },
                { id: 'resume', label: 'Benchmark CV', icon: Award },
                { id: 'glossary', label: 'Tech Knowledge', icon: BookOpen }
              ].map(tab => (
                <button 
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2.5 px-8 py-3 rounded-[1.25rem] text-xs font-black transition-all ${activeTab === tab.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                >
                  <tab.icon size={18}/> {tab.label}
                </button>
              ))}
            </nav>

            {/* Tab Contents */}
            {activeTab === 'strategy' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                {/* Left: Summary & Preferences */}
                <div className="md:col-span-2 space-y-10">
                  <section className="bg-white rounded-[3.5rem] p-12 shadow-2xl shadow-slate-200/50 border border-slate-100">
                    <h3 className="text-2xl font-black mb-8 flex items-center gap-4 text-slate-800"><Info className="text-indigo-600" size={28}/> Executive Intelligence</h3>
                    <p className="text-slate-600 text-xl font-medium leading-relaxed border-l-[6px] border-indigo-100 pl-10 italic">"{currentAnalysis?.jobSummary}"</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mt-12">
                      <div className="space-y-5">
                        <h4 className="text-[10px] font-black uppercase text-indigo-400 tracking-[0.2em] mb-4">Tactical Non-Negotiables</h4>
                        <ul className="space-y-4">
                          {currentAnalysis?.priorityRequirements?.map((r, i) => (
                            <li key={i} className="flex gap-4 text-sm font-bold text-slate-800 bg-slate-50/50 p-4 rounded-2xl border border-slate-100"><CheckCircle2 className="text-green-500 shrink-0" size={20}/> {r}</li>
                          )) || <li className="text-slate-400 text-xs italic">N/A</li>}
                        </ul>
                      </div>
                      <div className="space-y-5">
                        <h4 className="text-[10px] font-black uppercase text-indigo-400 tracking-[0.2em] mb-4">Submission Playbook</h4>
                        <ul className="space-y-4">
                          {currentAnalysis?.submissionTips?.map((t, i) => (
                            <li key={i} className="flex gap-4 text-sm font-bold text-indigo-700 bg-indigo-50/30 p-4 rounded-2xl border border-indigo-100 italic">
                              <span className="text-indigo-600 font-black">#</span> {t}
                            </li>
                          )) || <li className="text-slate-400 text-xs italic">N/A</li>}
                        </ul>
                      </div>
                    </div>
                  </section>

                  {/* Sourcing Taxonomy */}
                  <section className="bg-slate-900 rounded-[3.5rem] p-12 text-white shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-12 opacity-5 rotate-12 group-hover:rotate-0 transition-transform duration-700"><Search size={200}/></div>
                    <h3 className="text-2xl font-black mb-10 tracking-tight flex items-center gap-4"><Waves className="text-indigo-400" size={28}/> Sourcing Architecture</h3>
                    <div className="space-y-10 relative z-10">
                      <div>
                        <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-4">Master Boolean String (Global Search)</h4>
                        <div className="bg-slate-800 p-8 rounded-[2rem] font-mono text-[11px] text-indigo-200 break-words border border-slate-700 leading-relaxed shadow-inner">
                          {currentAnalysis?.keywords?.booleanStrings?.[0] || 'Compiling sourcing logic...'}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-10">
                        <div>
                          <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-4">Focus Keywords</h4>
                          <div className="flex flex-wrap gap-2.5">
                            {currentAnalysis?.keywords?.primary?.map((k, i) => (
                              <span key={i} className="px-4 py-2 bg-slate-800 text-indigo-100 rounded-xl text-[10px] font-black border border-slate-700 hover:border-indigo-500 transition-colors">{k}</span>
                            )) || <span className="text-slate-600 text-[10px] italic">Extracting...</span>}
                          </div>
                        </div>
                        <div>
                          <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-4">Target Competition</h4>
                          <div className="flex flex-wrap gap-2.5">
                            {currentAnalysis?.targetCompanies?.map((c, i) => (
                              <span key={i} className="px-4 py-2 bg-slate-800 text-slate-400 rounded-xl text-[10px] font-black border border-slate-700 hover:border-slate-500 transition-colors">{c}</span>
                            )) || <span className="text-slate-600 text-[10px] italic">Researching...</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>

                {/* Right: Candidate Analysis if exists */}
                <div className="space-y-10">
                  {currentAnalysis?.candidateAnalysis ? (
                    <div className="bg-white rounded-[3.5rem] p-10 shadow-2xl shadow-slate-200/50 border border-slate-100 space-y-12">
                      <div className="text-center">
                        <div className="inline-flex flex-col items-center justify-center w-40 h-40 rounded-full border-[10px] border-indigo-50 bg-indigo-50/20 mb-6 shadow-inner animate-in zoom-in duration-500">
                          <span className="text-5xl font-black text-indigo-700">{currentAnalysis.candidateAnalysis.overallMatchPercentage || 0}%</span>
                          <span className="text-[10px] font-black uppercase text-indigo-400 tracking-[0.2em] mt-1">Audit Score</span>
                        </div>
                      </div>

                      {/* ATS Integrity Audit Section */}
                      {currentAnalysis.candidateAnalysis.keywordStuffingAnalysis && (
                        <div className="p-8 bg-slate-900 rounded-[2.5rem] border border-slate-800 shadow-2xl relative overflow-hidden group">
                          <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:scale-125 group-hover:-rotate-12 transition-all duration-500"><ShieldAlert size={80} className="text-white"/></div>
                          <h4 className="text-[11px] font-black uppercase text-indigo-400 tracking-[0.2em] mb-6 flex items-center gap-3">
                            <Fingerprint size={16}/> ATS Integrity Audit
                          </h4>
                          <div className="space-y-5 relative z-10">
                            <div className="flex items-center justify-between bg-slate-800/50 p-3 rounded-xl border border-slate-700">
                              <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Risk Factor</span>
                              <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${
                                currentAnalysis.candidateAnalysis.keywordStuffingAnalysis.riskLevel === 'Low' ? 'bg-green-500 text-white' : 
                                currentAnalysis.candidateAnalysis.keywordStuffingAnalysis.riskLevel === 'Elevated' ? 'bg-orange-500 text-white' : 'bg-red-500 text-white'
                              }`}>
                                {currentAnalysis.candidateAnalysis.keywordStuffingAnalysis.riskLevel || 'Unknown'}
                              </span>
                            </div>
                            <p className="text-[12px] text-slate-300 leading-relaxed font-medium">
                              {currentAnalysis.candidateAnalysis.keywordStuffingAnalysis.findings || 'No stuffing patterns identified.'}
                            </p>
                            {currentAnalysis.candidateAnalysis.keywordStuffingAnalysis.detectedArtificialClusters?.length > 0 && (
                              <div className="pt-4 border-t border-slate-800">
                                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-3">JD Phrases Injected</span>
                                <div className="flex flex-wrap gap-2">
                                  {currentAnalysis.candidateAnalysis.keywordStuffingAnalysis.detectedArtificialClusters.map((term, i) => (
                                    <span key={i} className="px-2.5 py-1.5 bg-red-900/40 text-red-300 rounded-lg text-[10px] font-mono border border-red-800/50">{term}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="space-y-8">
                        <div className="flex items-center justify-between p-5 bg-slate-50 rounded-2xl border border-slate-100 shadow-sm">
                          <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Authenticity Score</span>
                          <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                            currentAnalysis.candidateAnalysis.authenticityScore === 'High' ? 'bg-green-100 text-green-700' : 
                            currentAnalysis.candidateAnalysis.authenticityScore === 'Caution' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'
                          }`}>{currentAnalysis.candidateAnalysis.authenticityScore || 'N/A'}</span>
                        </div>
                        <div className="space-y-4">
                          <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mb-4 flex items-center gap-3"><History size={16}/> Tenure & Gap Analysis</h4>
                          <div className="space-y-3">
                            {currentAnalysis.candidateAnalysis.employmentGaps?.map((g, i) => <div key={i} className="text-xs font-bold text-red-700 bg-red-50 p-4 rounded-2xl border border-red-100 shadow-sm">GAP: {g}</div>) || []}
                            {currentAnalysis.candidateAnalysis.shortTermAssignments?.map((s, i) => <div key={i} className="text-xs font-bold text-orange-700 bg-orange-50 p-4 rounded-2xl border border-orange-100 shadow-sm">STINT: {s}</div>) || []}
                            {(!currentAnalysis.candidateAnalysis.employmentGaps?.length && !currentAnalysis.candidateAnalysis.shortTermAssignments?.length) && <p className="text-xs text-slate-400 italic bg-slate-50 p-4 rounded-2xl text-center">No stability concerns identified.</p>}
                          </div>
                        </div>
                        <div className="p-8 bg-indigo-50/50 rounded-[2.5rem] border border-indigo-100 shadow-sm">
                          <h4 className="text-xs font-black uppercase text-indigo-700 tracking-[0.2em] mb-6">Recruiter Vetting Matrix</h4>
                          <ul className="space-y-5">
                            {currentAnalysis.candidateAnalysis.recruiterQuestions?.map((q, i) => <li key={i} className="text-sm font-bold text-indigo-900 leading-snug flex gap-3"><PlusCircle size={16} className="text-indigo-400 shrink-0 mt-0.5"/> "{q}"</li>) || <li className="text-xs italic text-slate-400">N/A</li>}
                          </ul>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white rounded-[3.5rem] p-12 shadow-2xl shadow-slate-200/50 border border-slate-100 border-dashed flex flex-col items-center justify-center text-center opacity-70 h-full min-h-[500px]">
                      <Fingerprint size={64} className="text-slate-200 mb-6"/>
                      <p className="text-lg font-black text-slate-400">Forensic Audit Required</p>
                      <p className="text-xs text-slate-400 mt-3 max-w-[220px] leading-relaxed">Analyze a resume alongside the JD to perform a forensic audit of tenure, authenticity, and keyword stuffing.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Benchmark Resume Tab */}
            {activeTab === 'resume' && (
              <div className="max-w-4xl mx-auto space-y-8 animate-in slide-in-from-bottom-6 duration-500">
                <div className="flex items-center justify-between no-print px-8">
                  <div>
                    <h3 className="text-2xl font-black text-slate-800">Benchmark Candidate Matrix</h3>
                    <p className="text-xs text-slate-400 font-black tracking-[0.2em] uppercase mt-1">Ideal profile architecture for this mandate</p>
                  </div>
                  <button onClick={() => window.print()} className="bg-white border border-slate-200 text-slate-900 px-8 py-3 rounded-2xl text-xs font-black hover:bg-slate-50 shadow-xl transition-all flex items-center gap-3">
                    <Download size={18}/> Export Profile (PDF)
                  </button>
                </div>
                <div className="bg-white p-24 shadow-2xl border border-slate-100 mx-auto w-full min-h-[1100px] resume-container rounded-sm">
                  {currentAnalysis && <ResumeRenderer markdown={currentAnalysis.sampleResume} />}
                </div>
              </div>
            )}

            {/* Tech Glossary Tab */}
            {activeTab === 'glossary' && (
              <div className="space-y-10 animate-in zoom-in duration-500">
                <header className="bg-indigo-600 rounded-[3.5rem] p-16 text-white shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-16 opacity-10 rotate-12 scale-150"><BookOpen size={200}/></div>
                  <div className="relative z-10 space-y-6">
                    <h3 className="text-4xl font-black tracking-tight">Technical Knowledge Decoder</h3>
                    <p className="text-indigo-100 text-xl max-w-2xl leading-relaxed font-medium">Equipping recruiters with deep contextual understanding of technical requirements found in the Job Description.</p>
                  </div>
                </header>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {currentAnalysis?.techGlossary?.map((item, i) => (
                    <div key={i} className="bg-white p-10 rounded-[2.5rem] shadow-xl shadow-slate-200/30 border border-slate-100 group hover:border-indigo-400 transition-all hover:-translate-y-2">
                      <div className="w-12 h-1 bg-indigo-200 mb-6 group-hover:w-full transition-all duration-500"></div>
                      <h4 className="text-indigo-600 font-black mb-4 text-xl tracking-tight">{item.term}</h4>
                      <p className="text-slate-600 text-sm leading-relaxed font-bold">{item.explanation}</p>
                    </div>
                  )) || <div className="text-slate-400 italic col-span-full py-20 text-center">No technical glossary entries compiled for this requirement.</div>}
                </div>
              </div>
            )}

          </div>
        )}

        {/* Floating Active Indicator */}
        {isLiveActive && (
          <div className="fixed bottom-12 right-12 z-50 animate-in slide-in-from-right-10 duration-500">
            <div className="bg-slate-900 text-white px-8 py-4 rounded-[2rem] shadow-[0_35px_60px_-15px_rgba(79,70,229,0.3)] flex items-center gap-4 border border-indigo-500 ring-8 ring-indigo-500/10">
              <div className="flex gap-1 items-end h-6">
                {[1,2,3,4,5].map(i => <div key={i} className="w-1.5 bg-indigo-400 rounded-full animate-wave" style={{ height: `${Math.random()*100}%`, animationDelay: `${i*150}ms` }} />)}
              </div>
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-indigo-100">Audit Assistant Active</span>
            </div>
          </div>
        )}
      </main>
      
      <style>{`
        @keyframes wave {
          0%, 100% { height: 20%; }
          50% { height: 100%; }
        }
        .animate-wave { animation: wave 1s infinite ease-in-out; }
        .shake { animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both; }
        @keyframes shake {
          10%, 90% { transform: translate3d(-1px, 0, 0); }
          20%, 80% { transform: translate3d(2px, 0, 0); }
          30%, 50%, 70% { transform: translate3d(-4px, 0, 0); }
          40%, 60% { transform: translate3d(4px, 0, 0); }
        }
      `}</style>
    </div>
  );
}
