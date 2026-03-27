/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Moon, Sun, Send, Book, Scroll, Info, MessageSquare, 
  LogOut, LogIn, Plus, History, Menu, X, Trash2, User as UserIcon,
  ChevronRight, Sparkles, Languages, Check, Copy, ExternalLink, BookOpen, Download,
  Mic, File as FileIcon, Paperclip, Volume2, VolumeX, MapPin, Loader2,
  Play, Heart, Share2, MessageCircle, Baby, Search, Pencil
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format } from 'date-fns';

import { getIslamicAnswer, getDailyInspiration, findNearbyIslamicPlaces } from './lib/gemini';
import { 
  auth, db, googleProvider, OperationType, handleFirestoreError 
} from './firebase';
import { 
  signInWithPopup, signOut, onAuthStateChanged, User 
} from 'firebase/auth';
import { 
  collection, doc, setDoc, addDoc, query, where, orderBy, 
  onSnapshot, serverTimestamp, deleteDoc, updateDoc, getDocs
} from 'firebase/firestore';
import { languages, translations, Language } from './translations';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface ChatSession {
  id: string;
  title: string;
  isPublic?: boolean;
  createdAt: any;
  updatedAt: any;
}

interface Reference {
  type: 'quran' | 'hadith' | 'other';
  citation: string;
  arabic?: string;
  translation?: string;
}

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: any;
  references?: Reference[];
  wordAnalysis?: { word: string; meaning: string; root?: string }[];
  relatedQuestions?: string[];
  summary?: string;
  mood?: string;
  correctedPrompt?: string | null;
  attachments?: { mimeType: string; data: string }[];
  visual?: string;
  video?: string;
  links?: { title: string; url: string }[];
}

interface FileAttachment {
  file: File;
  preview: string;
  base64: string;
}

const Logo = ({ className }: { className?: string }) => (
  <div className={cn("relative flex items-center justify-center rounded-xl bg-[#D4AF37] shadow-lg", className)}>
    {/* Robust Centered Crescent */}
    <svg viewBox="0 0 100 100" className="w-3/4 h-3/4 text-white fill-current overflow-visible">
      <path 
        d="M70,15 C50,15 30,35 30,55 C30,75 50,95 70,95 C55,90 45,75 45,55 C45,35 55,20 70,15 Z" 
        transform="rotate(-25 50 55)" 
      />
    </svg>
  </div>
);

interface AppUser extends User {
  subscriptionTier?: 'free' | 'scholar' | 'scholar_gold';
  dailyQuestionCount?: number;
  lastQuestionReset?: any;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center p-6 bg-[var(--bg)] text-center">
          <div className="p-6 rounded-3xl bg-red-500/10 border border-red-500/20 max-w-md">
            <h1 className="text-2xl font-serif italic text-red-500 mb-4">Something went wrong</h1>
            <p className="text-sm opacity-70 mb-6">
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2 rounded-xl bg-gold text-white font-bold hover:bg-gold-dark transition-all"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isPricingOpen, setIsPricingOpen] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(true); // Default to dark for better aesthetic
  const [isKidsMode, setIsKidsMode] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [lang, setLang] = useState<Language>('en');
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const [shuffledSuggestions, setShuffledSuggestions] = useState<string[]>([]);
  const [dailyInspiration, setDailyInspiration] = useState<any>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean>(true);
  const [isAiStudio, setIsAiStudio] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  const [isSpeaking, setIsSpeaking] = useState<string | null>(null);
  const [playingAyah, setPlayingAyah] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const t = translations[lang];

  const speak = (text: string, id: string) => {
    if (isSpeaking === id) {
      window.speechSynthesis.cancel();
      setIsSpeaking(null);
      return;
    }
    
    window.speechSynthesis.cancel();
    
    // Clean text for TTS: remove markdown asterisks, hashes, etc.
    const cleanText = text
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/#/g, '')
      .replace(/__/g, '')
      .replace(/_/g, '')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1'); // Remove links but keep text

    const utterance = new SpeechSynthesisUtterance(cleanText);
    const langMap: Record<Language, string> = {
      en: 'en-US',
      ar: 'ar-SA',
      de: 'de-DE',
      es: 'es-ES',
      fr: 'fr-FR',
      zh: 'zh-CN',
      ur: 'ur-PK',
      ja: 'ja-JP',
      it: 'it-IT',
      tr: 'tr-TR'
    };
    utterance.lang = langMap[lang] || 'en-US';
    utterance.onend = () => setIsSpeaking(null);
    setIsSpeaking(id);
    window.speechSynthesis.speak(utterance);
  };

  const playAyahAudio = async (surah: string, ayah: string, id: string) => {
    const key = `${surah}:${ayah}-${id}`;
    if (playingAyah === key) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingAyah(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    setPlayingAyah(key);
    try {
      const response = await fetch(`https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/ar.mahermuaiqly`);
      const data = await response.json();
      if (data.code === 200 && data.data.audio) {
        const audio = new Audio(data.data.audio);
        audioRef.current = audio;
        audio.onended = () => setPlayingAyah(null);
        audio.play();
      } else {
        setPlayingAyah(null);
        setError("Could not load audio for this verse.");
      }
    } catch (err) {
      console.error(err);
      setPlayingAyah(null);
      setError("Failed to fetch audio.");
    }
  };

  useEffect(() => {
    const checkApiKey = async () => {
      const defaultKey = process.env.GEMINI_API_KEY;
      const selectedKey = process.env.API_KEY;
      const userKey = import.meta.env.VITE_USER_API_KEY || process.env.USER_API_KEY;
      
      if (window.aistudio) {
        setIsAiStudio(true);
      }

      // If a key is provided in the project settings, we are good to go!
      if ((defaultKey && defaultKey !== 'undefined' && defaultKey !== 'null' && defaultKey.length > 10) || 
          (selectedKey && selectedKey !== 'undefined' && selectedKey !== 'null' && selectedKey.length > 10) ||
          (userKey && userKey !== 'undefined' && userKey !== 'null' && userKey.length > 10)) {
        setHasApiKey(true);
        return;
      }

      // Otherwise, check if the user has selected one in the preview
      if (window.aistudio?.hasSelectedApiKey) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(selected);
      } else {
        setHasApiKey(false);
      }
    };
    checkApiKey();
    
    // Shuffle suggestions and fetch inspiration
    const allSuggestions = translations[lang].suggestions;
    setShuffledSuggestions([...allSuggestions].sort(() => Math.random() - 0.5).slice(0, 4));
    
    const fetchInspiration = async () => {
      const today = new Date().toDateString();
      const cacheKey = `daily_inspiration_${lang}_${today}`;
      const cached = localStorage.getItem(cacheKey);
      
      if (cached) {
        try {
          setDailyInspiration(JSON.parse(cached));
          return;
        } catch (e) {
          localStorage.removeItem(cacheKey);
        }
      }

      const insp = await getDailyInspiration(lang);
      if (insp) {
        setDailyInspiration(insp);
        localStorage.setItem(cacheKey, JSON.stringify(insp));
      } else {
        // Fallback inspiration if API fails (e.g., quota exceeded)
        const fallbacks: Record<string, any> = {
          en: {
            text: "And seek help through patience and prayer...",
            arabic: "وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ",
            translation: "And seek help through patience and prayer, and indeed, it is difficult except for the humbly submissive [to Allah].",
            citation: "Quran 2:45",
            reflection: "Patience and prayer are the keys to overcoming any difficulty."
          },
          ar: {
            text: "وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ",
            arabic: "وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ",
            translation: "وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ ۚ وَإِنَّهَا لَكَبِيرَةٌ إِلَّا عَلَى الْخَاشِعِينَ",
            citation: "سورة البقرة 2:45",
            reflection: "الصبر والصلاة هما مفتاح تجاوز كل الصعوبات."
          },
          tr: {
            text: "Sabır ve namazla yardım dileyin...",
            arabic: "وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ",
            translation: "Sabır ve namazla Allah'tan yardım dileyin. Şüphesiz bu, huşû duyanlardan başkasına ağır gelir.",
            citation: "Bakara 2:45",
            reflection: "Sabır ve namaz, her türlü zorluğun üstesinden gelmenin anahtarıdır."
          },
          ur: {
            text: "صبر اور نماز کے ذریعے مدد حاصل کرو...",
            arabic: "وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ",
            translation: "صبر اور نماز کے ذریعے مدد حاصل کرو، اور بے شک یہ بہت بھاری ہے سوائے ان لوگوں کے جو عاجزی کرنے والے ہیں۔",
            citation: "القرآن 2:45",
            reflection: "صبر اور نماز ہر مشکل پر قابو پانے کی کلید ہیں۔"
          },
          de: {
            text: "Sucht Hilfe in Geduld und Gebet...",
            arabic: "وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ",
            translation: "Sucht Hilfe in Geduld und Gebet; dies ist freilich schwer, außer für Demütige.",
            citation: "Koran 2:45",
            reflection: "Geduld und Gebet sind die Schlüssel zur Überwindung jeder Schwierigkeit."
          },
          fr: {
            text: "Cherchez secours dans l'endurance et la prière...",
            arabic: "وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ",
            translation: "Et cherchez secours dans l'endurance et la prière: certes, la prière est une lourde obligation, sauf pour les humbles.",
            citation: "Coran 2:45",
            reflection: "La patience et la prière sont les clés pour surmonter toute difficulté."
          },
          es: {
            text: "Buscad ayuda en la paciencia y la oración...",
            arabic: "وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ",
            translation: "Buscad ayuda en la paciencia y la oración; esto es ciertamente difícil, excepto para los humildes.",
            citation: "Corán 2:45",
            reflection: "La paciencia y la oración son las llaves para superar cualquier dificultad."
          },
          zh: {
            text: "你们当借坚忍和礼拜而求佑助...",
            arabic: "وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ",
            translation: "你们当借坚忍和礼拜而求佑助。那件事对于谦恭的人，固然不难。",
            citation: "古兰经 2:45",
            reflection: "坚忍和礼拜是克服任何困难的关键。"
          },
          ja: {
            text: "忍耐と礼拝によって、助けを求めなさい...",
            arabic: "وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ",
            translation: "忍耐と礼拝によって、（主の）助けを求めなさい。それは、謙虚な者たちのほかには、本当に大変なことである。",
            citation: "クルアーン 2:45",
            reflection: "忍耐と礼拝は、あらゆる困難を克服するための鍵です。"
          },
          it: {
            text: "Cercate aiuto nella pazienza e nella preghiera...",
            arabic: "وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ",
            translation: "Cercate aiuto nella pazienza e nella preghiera: è cosa gravosa, ma non per gli umili.",
            citation: "Corano 2:45",
            reflection: "La pazienza e la preghiera sono le chiavi per superare ogni difficoltà."
          }
        };
        const fallback = fallbacks[lang] || fallbacks['en'];
        setDailyInspiration(fallback);
        // Cache the fallback so we don't keep hitting the API for this language/day
        localStorage.setItem(cacheKey, JSON.stringify(fallback));
      }
    };
    fetchInspiration();
  }, [lang]);

  const handleSelectKey = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  // PWA Install Prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      const isIframe = window.self !== window.top;
      if (isIframe) {
        window.open(window.location.href, '_blank');
      } else {
        alert(lang === 'ar' || lang === 'ur' 
          ? "يمكنك تثبيت التطبيق من خلال قائمة المتصفح (إضافة إلى الشاشة الرئيسية)" 
          : "You can install the app via your browser menu (Add to Home Screen)");
      }
    }
  };

  // Voice Input Logic
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      const langMap: Record<Language, string> = {
        en: 'en-US',
        ar: 'ar-SA',
        de: 'de-DE',
        es: 'es-ES',
        fr: 'fr-FR',
        zh: 'zh-CN',
        ur: 'ur-PK',
        ja: 'ja-JP',
        it: 'it-IT',
        tr: 'tr-TR'
      };
      recognition.lang = langMap[lang] || 'en-US';

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(prev => prev + (prev ? ' ' : '') + transcript);
        setIsRecording(false);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
        if (event.error !== 'no-speech') {
          setError(`Speech recognition error: ${event.error}`);
        }
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
    }
  }, [lang]);

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
    } else {
      setError(null);
      try {
        recognitionRef.current?.start();
        setIsRecording(true);
      } catch (err) {
        console.error('Failed to start recording:', err);
        setError('Could not start voice recognition. Please ensure microphone access is granted.');
      }
    }
  };

  // File Upload Logic
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newAttachments: FileAttachment[] = [];

    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) {
        setError(`File ${file.name} is too large. Max size is 5MB.`);
        continue;
      }

      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
      });

      reader.readAsDataURL(file);
      const base64 = await base64Promise;
      const preview = URL.createObjectURL(file);

      newAttachments.push({ file, preview, base64 });
    }

    setAttachments(prev => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => {
      const newArr = [...prev];
      URL.revokeObjectURL(newArr[index].preview);
      newArr.splice(index, 1);
      return newArr;
    });
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) {
        const userRef = doc(db, 'users', u.uid);
        // Initial user setup
        setDoc(userRef, {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          photoURL: u.photoURL,
          updatedAt: serverTimestamp()
        }, { merge: true }).catch(e => handleFirestoreError(e, OperationType.WRITE, `users/${u.uid}`));
        
        setUser(u as AppUser);
      } else {
        setUser(null);
        setChats([]);
        // Don't clear currentChatId if it's a public chat
        // setCurrentChatId(null);
        setMessages([]);
      }
      setIsAuthReady(true);
    });

    // Check for shared chat ID in URL
    const urlParams = new URLSearchParams(window.location.search);
    const sharedId = urlParams.get('chat');
    if (sharedId) {
      setCurrentChatId(sharedId);
    }

    return () => unsubscribe();
  }, []);

  // User Profile Listener
  useEffect(() => {
    if (!user?.uid) return;
    
    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userRef, (doc) => {
      if (doc.exists()) {
        setUser(prev => prev ? { ...prev, ...doc.data() } as AppUser : null);
      }
    }, (e) => {
      // Only handle if we are still logged in
      if (auth.currentUser) {
        handleFirestoreError(e, OperationType.GET, `users/${user.uid}`);
      }
    });
    
    return () => unsubscribe();
  }, [user?.uid]);

  // Theme Sync
  useEffect(() => {
    const root = window.document.documentElement;
    if (isDark) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [isDark]);

  // Click outside lang menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) {
        setIsLangMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Chats Listener
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'chats'),
      where('userId', '==', user.uid),
      orderBy('updatedAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChatSession));
      setChats(chatList);
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'chats'));
    return () => unsubscribe();
  }, [user]);

  // Messages Listener
  useEffect(() => {
    if (!currentChatId) {
      setMessages([]);
      return;
    }
    const q = query(
      collection(db, 'chats', currentChatId, 'messages'),
      orderBy('timestamp', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
      setMessages(msgList);
    }, (e) => {
      // If it's a public chat, we might still have access even if not logged in
      handleFirestoreError(e, OperationType.LIST, `chats/${currentChatId}/messages`);
    });
    return () => unsubscribe();
  }, [currentChatId]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const login = () => signInWithPopup(auth, googleProvider);
  const logout = () => signOut(auth);

  const createNewChat = async () => {
    if (!user) return;
    try {
      const chatRef = await addDoc(collection(db, 'chats'), {
        userId: user.uid,
        title: t.newChat,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setCurrentChatId(chatRef.id);
      setIsSidebarOpen(false);
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'chats');
    }
  };

  const deleteChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, 'chats', id));
      if (currentChatId === id) setCurrentChatId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `chats/${id}`);
    }
  };

  const renameChat = async (id: string, newTitle: string) => {
    if (!user || !newTitle.trim()) {
      setEditingChatId(null);
      return;
    }
    try {
      await updateDoc(doc(db, 'chats', id), {
        title: newTitle.trim(),
        updatedAt: serverTimestamp()
      });
      setEditingChatId(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `chats/${id}`);
    }
  };

  const shareChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    try {
      await updateDoc(doc(db, 'chats', id), {
        isPublic: true
      });
      const shareUrl = `${window.location.origin}${window.location.pathname}?chat=${id}`;
      await navigator.clipboard.writeText(shareUrl);
      alert('Share link copied to clipboard!');
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `chats/${id}`);
    }
  };

  const filteredChats = chats.filter(chat => 
    chat.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const checkUsageLimit = () => {
    if (!user) return true;
    
    // Bypass for developer accounts
    const devEmails = ['yosefahmed1710@gmail.com', 'yosef.elsaid.10@gmail.com'];
    const currentUserEmail = auth.currentUser?.email?.toLowerCase();
    if (currentUserEmail && devEmails.some(email => email.toLowerCase() === currentUserEmail)) return true;
    
    const tier = user.subscriptionTier || 'free';
    const limits = {
      free: 10,
      scholar: 40,
      scholar_gold: 120
    };
    
    const limit = limits[tier];
    const count = user.dailyQuestionCount || 0;
    const lastReset = user.lastQuestionReset;
    
    // Check if it's a new day
    const now = new Date();
    const lastResetDate = lastReset ? (lastReset.toDate ? lastReset.toDate() : new Date(lastReset)) : new Date(0);
    
    const isNewDay = now.toDateString() !== lastResetDate.toDateString();
    
    if (isNewDay) {
      // Logic to reset count will happen in handleNormalSubmit
      return true;
    }
    
    if (count >= limit) {
      setIsPricingOpen(true);
      return false;
    }
    
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && attachments.length === 0) || isLoading) return;
    if (!user) {
      login();
      return;
    }

    if (!checkUsageLimit()) return;

    const userText = input.trim();
    const currentAttachments = attachments.map(a => ({
      mimeType: a.file.type,
      data: a.base64
    }));

    setInput('');
    setAttachments([]);
    setIsLoading(true);
    setError(null);

    // Auto-detect language from user input
    let detectedLang: Language = lang;
    const arabicRegex = /[\u0600-\u06FF]/;
    const turkishRegex = /[ığüşöçİĞÜŞÖÇ]/;
    const chineseRegex = /[\u4e00-\u9fa5]/;
    const japaneseRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;

    if (arabicRegex.test(userText)) {
      if (lang !== 'ar' && lang !== 'ur') detectedLang = 'ar';
    } else if (turkishRegex.test(userText)) {
      if (lang !== 'tr') detectedLang = 'tr';
    } else if (chineseRegex.test(userText)) {
      if (lang !== 'zh') detectedLang = 'zh';
    } else if (japaneseRegex.test(userText)) {
      if (lang !== 'ja') detectedLang = 'ja';
    } else if (/[äöüßÄÖÜ]/.test(userText)) {
      if (lang !== 'de') detectedLang = 'de';
    } else if (/[éàèùâêîôûëïüç]/.test(userText)) {
      if (lang !== 'fr') detectedLang = 'fr';
    } else if (/[áéíóúüñ¿¡]/.test(userText)) {
      if (lang !== 'es') detectedLang = 'es';
    } else if (/[àèéìòóù]/.test(userText)) {
      if (lang !== 'it') detectedLang = 'it';
    }

    if (detectedLang !== lang) {
      setLang(detectedLang);
    }

    // Check for "find nearby" or "mosque" or "halal"
    const isMapQuery = userText.toLowerCase().includes('nearby') || 
                       userText.toLowerCase().includes('mosque') || 
                       userText.toLowerCase().includes('halal') ||
                       userText.toLowerCase().includes('masjid');

    if (isMapQuery && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const result = await findNearbyIslamicPlaces(userText, latitude, longitude, detectedLang);
          
          let chatId = currentChatId;
          if (!chatId) {
            const chatRef = await addDoc(collection(db, 'chats'), {
              userId: user.uid,
              title: userText.slice(0, 30),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
            chatId = chatRef.id;
            setCurrentChatId(chatId);
          }

          await addDoc(collection(db, 'chats', chatId, 'messages'), {
            chatId,
            role: 'user',
            text: userText,
            timestamp: serverTimestamp()
          });

          await addDoc(collection(db, 'chats', chatId, 'messages'), {
            chatId,
            role: 'model',
            text: result.text,
            links: result.links,
            timestamp: serverTimestamp()
          });
          setIsLoading(false);
        } catch (err) {
          console.error(err);
          handleNormalSubmit(userText, currentAttachments, detectedLang);
        }
      }, (err) => {
        console.error(err);
        handleNormalSubmit(userText, currentAttachments, detectedLang);
      });
      return;
    }

    handleNormalSubmit(userText, currentAttachments, detectedLang);
  };

  const handleNormalSubmit = async (userText: string, currentAttachments: any[], currentLang: Language) => {
    try {
      // Increment usage count
      if (user) {
        const devEmails = ['yosefahmed1710@gmail.com', 'yosef.elsaid.10@gmail.com'];
        const currentUserEmail = auth.currentUser?.email?.toLowerCase();
        const isDev = currentUserEmail && devEmails.some(email => email.toLowerCase() === currentUserEmail);
        
        if (!isDev) {
          const userRef = doc(db, 'users', user.uid);
          const now = new Date();
          const lastReset = user.lastQuestionReset;
          const lastResetDate = lastReset ? (lastReset.toDate ? lastReset.toDate() : new Date(lastReset)) : new Date(0);
          const isNewDay = now.toDateString() !== lastResetDate.toDateString();

          await updateDoc(userRef, {
            dailyQuestionCount: isNewDay ? 1 : (user.dailyQuestionCount || 0) + 1,
            lastQuestionReset: serverTimestamp()
          });
        }
      }

      let chatId = currentChatId;
      if (!chatId) {
        const chatRef = await addDoc(collection(db, 'chats'), {
          userId: user?.uid,
          title: userText.slice(0, 40) + (userText.length > 40 ? '...' : ''),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        chatId = chatRef.id;
        setCurrentChatId(chatId);
      }

      if (window.aistudio?.hasSelectedApiKey) {
        const selected = await window.aistudio.hasSelectedApiKey();
        const defaultKey = process.env.GEMINI_API_KEY;
        if (!selected && (!defaultKey || defaultKey === 'undefined')) {
          setHasApiKey(false);
          setError('Connection setup needed. Please click the button below.');
          return;
        }
      }

      // Get history BEFORE adding the new message to avoid duplication
      // if onSnapshot fires quickly
      const history = messages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      // Save user message
      // Note: We don't save large base64 to Firestore to avoid 1MB limit
      // We only save the text for now.
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        chatId,
        role: 'user',
        text: userText,
        hasAttachments: currentAttachments.length > 0,
        timestamp: serverTimestamp()
      });

      // Update chat title if it's the first message
      // This is now handled by the AI response to get a better title
      await updateDoc(doc(db, 'chats', chatId), {
        updatedAt: serverTimestamp()
      });

      const result = await getIslamicAnswer(userText, history, currentAttachments, isKidsMode, currentLang);
      
      if (!result) {
        throw new Error('No response from AI');
      }

      const { answer, references, relatedQuestions, summary, mood, title, correctedPrompt, wordAnalysis } = result;

      // Update chat title if it's the first message
      if (messages.length === 0 && title) {
        await updateDoc(doc(db, 'chats', chatId), {
          title: title,
          updatedAt: serverTimestamp()
        });
      } else {
        await updateDoc(doc(db, 'chats', chatId), {
          updatedAt: serverTimestamp()
        });
      }

      // Save AI message
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        chatId,
        role: 'model',
        text: answer,
        references: references || [],
        wordAnalysis: wordAnalysis || [],
        relatedQuestions: relatedQuestions || [],
        summary: summary || '',
        mood: mood || '',
        correctedPrompt: correctedPrompt || null,
        timestamp: serverTimestamp()
      });
    } catch (err: any) {
      console.error('Error:', err);
      const errorMessage = err.message || '';
      
      if (errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('quota') || errorMessage.includes('QUOTA_EXCEEDED')) {
        setError('The shared AI quota has been exceeded. Please wait a few minutes or provide your own API key to continue.');
        setHasApiKey(false); // Trigger the "Fix Connection" UI
      } else if (errorMessage.includes('API_KEY_MISSING') || errorMessage.includes('API key not valid') || errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('Requested entity was not found') || errorMessage.includes('permission denied')) {
        setHasApiKey(false);
        setError('There is a connection issue or permission denied. Please click "Fix Connection" below to select your API key.');
      } else if (errorMessage.includes('Rpc failed') || errorMessage.includes('500') || errorMessage.includes('xhr error')) {
        setError('The AI service is temporarily unavailable (500 error). We are retrying, but if this persists, please refresh the page or try again in a moment.');
      } else {
        setError(errorMessage || 'An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-white dark:bg-black">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <Logo className="w-24 h-24" />
        </motion.div>
      </div>
    );
  }

  const handleUpgrade = async (tier: string) => {
    if (!user) return;
    setIsProcessingPayment(true);
    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, tier, email: user.email })
      });
      const { url, error } = await response.json();
      if (error) throw new Error(error);
      window.location.href = url;
    } catch (err: any) {
      setError(`Payment error: ${err.message}`);
      setIsProcessingPayment(false);
    }
  };

  const PricingModal = () => (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[var(--card)] border border-[var(--border)] rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
      >
        <div className="p-6 border-b border-[var(--border)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gold/10 text-gold">
              <Sparkles size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--text)]">Pricing Plans</h2>
              <p className="text-xs text-[var(--text-muted)]">Choose a plan that fits your needs</p>
            </div>
          </div>
          <button onClick={() => setIsPricingOpen(false)} className="p-2 hover:bg-gold/10 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Free Tier */}
            <div className="p-5 rounded-2xl border border-[var(--border)] bg-white/5 flex flex-col">
            <div className="mb-4">
              <span className="text-2xl mb-2 block">🆓</span>
              <h3 className="font-bold text-lg">Free Tier</h3>
              <p className="text-xs text-[var(--text-muted)]">Enough to try the app</p>
            </div>
            <div className="text-2xl font-bold mb-4">£0<span className="text-xs font-normal text-[var(--text-muted)]">/mo</span></div>
            <ul className="text-xs space-y-2 mb-6 flex-grow">
              <li className="flex items-center gap-2"><Check size={12} className="text-gold" /> 10 questions / day</li>
              <li className="flex items-center gap-2"><Check size={12} className="text-gold" /> Basic AI features</li>
            </ul>
            <button 
              disabled={user?.subscriptionTier === 'free' || !user?.subscriptionTier}
              className="w-full py-2 rounded-xl border border-gold/20 text-gold text-xs font-bold hover:bg-gold/10 disabled:opacity-50"
            >
              {user?.subscriptionTier === 'free' || !user?.subscriptionTier ? 'Current Plan' : 'Select'}
            </button>
          </div>

          {/* Scholar Tier */}
          <div className="p-5 rounded-2xl border-2 border-gold/40 bg-gold/5 flex flex-col relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-gold text-white text-[8px] font-bold px-2 py-1 rounded-bl-lg uppercase">Popular</div>
            <div className="mb-4">
              <span className="text-2xl mb-2 block">🥈</span>
              <h3 className="font-bold text-lg">Scholar</h3>
              <p className="text-xs text-[var(--text-muted)]">Good for regular users</p>
            </div>
            <div className="text-2xl font-bold mb-4">£3.99<span className="text-xs font-normal text-[var(--text-muted)]">/mo</span></div>
            <ul className="text-xs space-y-2 mb-6 flex-grow">
              <li className="flex items-center gap-2"><Check size={12} className="text-gold" /> 40 questions / day</li>
              <li className="flex items-center gap-2"><Check size={12} className="text-gold" /> Faster responses</li>
            </ul>
            <button 
              onClick={() => handleUpgrade('scholar')}
              disabled={user?.subscriptionTier === 'scholar' || isProcessingPayment}
              className="w-full py-2 rounded-xl bg-gold text-white text-xs font-bold hover:bg-gold-dark transition-colors disabled:opacity-50"
            >
              {isProcessingPayment ? <Loader2 size={16} className="animate-spin mx-auto" /> : (user?.subscriptionTier === 'scholar' ? 'Current Plan' : 'Upgrade')}
            </button>
          </div>

          {/* Scholar Gold Tier */}
          <div className="p-5 rounded-2xl border border-[var(--border)] bg-white/5 flex flex-col">
            <div className="mb-4">
              <span className="text-2xl mb-2 block">🥇</span>
              <h3 className="font-bold text-lg">Scholar Gold</h3>
              <p className="text-xs text-[var(--text-muted)]">For heavy users</p>
            </div>
            <div className="text-2xl font-bold mb-4">£6.99<span className="text-xs font-normal text-[var(--text-muted)]">/mo</span></div>
            <ul className="text-xs space-y-2 mb-6 flex-grow">
              <li className="flex items-center gap-2"><Check size={12} className="text-gold" /> 120 questions / day</li>
              <li className="flex items-center gap-2"><Check size={12} className="text-gold" /> Priority support</li>
            </ul>
            <button 
              onClick={() => handleUpgrade('scholar_gold')}
              disabled={user?.subscriptionTier === 'scholar_gold' || isProcessingPayment}
              className="w-full py-2 rounded-xl border border-gold/20 text-gold text-xs font-bold hover:bg-gold/10 disabled:opacity-50"
            >
              {isProcessingPayment ? <Loader2 size={16} className="animate-spin mx-auto" /> : (user?.subscriptionTier === 'scholar_gold' ? 'Current Plan' : 'Upgrade')}
            </button>
          </div>
        </div>
      </div>
      
      <div className="p-4 bg-gold/5 text-center shrink-0">
          <p className="text-[10px] text-[var(--text-muted)]">
            Payments are processed securely via Stripe. You can cancel anytime.
          </p>
        </div>
      </motion.div>
    </div>
  );

  const handleDailyInspiration = async () => {
    const inspiration = await getDailyInspiration();
    if (inspiration) {
      const text = `**Daily Inspiration**\n\n${inspiration.text}\n\n*Reflection: ${inspiration.reflection}*`;
      
      let chatId = currentChatId;
      if (!chatId) {
        const chatRef = await addDoc(collection(db, 'chats'), {
          userId: user?.uid,
          title: 'Daily Inspiration',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        chatId = chatRef.id;
        setCurrentChatId(chatId);
      }

      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        chatId,
        role: 'model',
        text: text,
        references: [{ type: 'other', citation: inspiration.citation, arabic: inspiration.arabic, translation: inspiration.translation }],
        timestamp: serverTimestamp()
      });
    }
  };
  const getReferenceUrl = (ref: { type: string; citation: string }) => {
    if (ref.type.toLowerCase() === 'quran') {
      // Format: Quran 2:255
      const match = ref.citation.match(/(\d+):(\d+)/);
      if (match) {
        return `https://quran.com/${match[1]}/${match[2]}`;
      }
    } else if (ref.type.toLowerCase() === 'hadith') {
      // Format: Sahih Bukhari 1
      const citation = ref.citation.toLowerCase();
      let collection = '';
      let number = '';

      if (citation.includes('bukhari')) collection = 'bukhari';
      else if (citation.includes('muslim')) collection = 'muslim';
      else if (citation.includes('abu dawood') || citation.includes('abu dawud')) collection = 'abudawud';
      else if (citation.includes('tirmidhi')) collection = 'tirmidhi';
      else if (citation.includes('nasai')) collection = 'nasai';
      else if (citation.includes('ibn majah')) collection = 'ibnmajah';
      else if (citation.includes('riyad as-salihin') || citation.includes('riyad')) collection = 'riyadussalihin';
      else if (citation.includes('forty hadith') || citation.includes('nawawi')) collection = 'nawawi40';

      const numMatch = citation.match(/(\d+)$/);
      if (numMatch) number = numMatch[1];

      if (collection && number) {
        return `https://sunnah.com/${collection}/${number}`;
      }
    }
    return null;
  };

  return (
    <ErrorBoundary>
      <div className={cn(
        "h-screen flex overflow-hidden bg-[var(--bg)] text-[var(--text)] transition-colors duration-300",
        lang === 'ar' || lang === 'ur' ? "rtl" : "ltr",
        isMobile ? "text-sm" : "text-base"
      )}>
      <div className="absolute inset-0 islamic-pattern pointer-events-none z-0" />

      {/* Sidebar - Mobile Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm"
          />
        )}
      </AnimatePresence>

      {isPricingOpen && <PricingModal />}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 z-50 bg-[var(--sidebar)] border-r border-[var(--border)] transform transition-transform duration-300 lg:relative lg:translate-x-0 flex flex-col glass",
        isMobile ? "w-60" : "w-64",
        isSidebarOpen ? "translate-x-0" : (lang === 'ar' || lang === 'ur' ? "translate-x-full" : "-translate-x-full"),
        lang === 'ar' || lang === 'ur' ? "right-0 border-l border-r-0" : "left-0"
      )}>
        <div className={cn(
          "flex flex-col h-full",
          isMobile ? "p-2" : "p-3"
        )}>
          <button
            onClick={createNewChat}
            className={cn(
              "flex items-center gap-2 w-full rounded-xl border border-gold/30 hover:bg-gold/10 transition-all font-medium text-gold group",
              isMobile ? "p-2 text-[10px] mb-2" : "p-2.5 text-xs mb-4"
            )}
          >
            <Plus size={isMobile ? 14 : 16} className="group-hover:rotate-90 transition-transform" />
            {t.newChat}
          </button>

          {/* Search Bar */}
          <div className="relative mb-4 px-2">
            <Search size={12} className="absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
            <input
              type="text"
              placeholder="Search chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-[var(--border)] rounded-lg py-1.5 pl-8 pr-3 text-[10px] focus:outline-none focus:border-gold/50 transition-colors"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
            <div className={cn(
              "uppercase tracking-widest opacity-50 px-2 flex items-center gap-2",
              isMobile ? "text-[8px] mb-1" : "text-[10px] mb-1.5"
            )}>
              <History size={isMobile ? 8 : 10} /> {t.pastSearches}
            </div>
            {filteredChats.map(chat => (
              <div
                key={chat.id}
                onClick={() => {
                  setCurrentChatId(chat.id);
                  setIsSidebarOpen(false);
                }}
                className={cn(
                  "group flex items-center justify-between rounded-xl cursor-pointer transition-all",
                  isMobile ? "p-2 text-[10px]" : "p-2.5 text-xs",
                  currentChatId === chat.id ? "bg-gold/20 text-gold border border-gold/20" : "hover:bg-gold/5 opacity-80 hover:opacity-100"
                )}
              >
                <div className="flex items-center gap-2 truncate flex-1">
                  <MessageSquare size={isMobile ? 10 : 12} className="shrink-0" />
                  {editingChatId === chat.id ? (
                    <input
                      autoFocus
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') renameChat(chat.id, editingTitle);
                        if (e.key === 'Escape') setEditingChatId(null);
                      }}
                      onBlur={() => renameChat(chat.id, editingTitle)}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-transparent border-none focus:outline-none w-full text-inherit"
                    />
                  ) : (
                    <span className="truncate">{chat.title}</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {editingChatId !== chat.id && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingChatId(chat.id);
                          setEditingTitle(chat.title);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-gold transition-all"
                      >
                        <Pencil size={isMobile ? 10 : 12} />
                      </button>
                      <button
                        onClick={(e) => shareChat(chat.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-gold transition-all"
                        title="Share Chat"
                      >
                        <Share2 size={isMobile ? 10 : 12} />
                      </button>
                      <button
                        onClick={(e) => deleteChat(chat.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-all"
                      >
                        <Trash2 size={isMobile ? 10 : 12} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className={cn(
            "mt-auto border-t border-[var(--border)]",
            isMobile ? "pt-2 space-y-1" : "pt-3 space-y-1.5"
          )}>
            <button
              onClick={handleInstall}
              className={cn(
                "flex items-center gap-2 w-full rounded-xl border border-gold/30 hover:bg-gold/10 transition-all font-medium text-gold group",
                isMobile ? "p-2 text-[10px]" : "p-2.5 text-xs"
              )}
            >
              <Download size={isMobile ? 14 : 16} className="group-hover:bounce transition-transform" />
              {deferredPrompt ? t.installApp : (window.self !== window.top ? t.openInNewTab : t.installApp)}
            </button>
            {(!deferredPrompt && window.self !== window.top) && (
              <p className="text-[8px] opacity-40 px-2 leading-tight">
                {lang === 'ar' || lang === 'ur' 
                  ? "للتثبيت، افتح في نافذة جديدة أولاً" 
                  : "To install, open in a new tab first"}
              </p>
            )}

            {user && (
              <button 
                onClick={() => {
                  setIsPricingOpen(true);
                  if (isMobile) setIsSidebarOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gold/10 text-gold transition-all group border border-gold/10",
                  isMobile ? "mb-1" : "mb-1.5"
                )}
              >
                <div className={cn(
                  "rounded-lg bg-gold/10 group-hover:bg-gold/20 transition-colors",
                  isMobile ? "p-1" : "p-1.5"
                )}>
                  <Sparkles size={isMobile ? 14 : 16} />
                </div>
                <div className="flex-grow text-left">
                  <div className={isMobile ? "text-[10px] font-bold" : "text-xs font-bold"}>Upgrade Plan</div>
                  <div className={isMobile ? "text-[8px] opacity-60" : "text-[9px] opacity-60"}>
                    {(() => {
                      const devEmails = ['yosefahmed1710@gmail.com', 'yosef.elsaid.10@gmail.com'];
                      const currentUserEmail = auth.currentUser?.email?.toLowerCase();
                      const isDev = currentUserEmail && devEmails.some(email => email.toLowerCase() === currentUserEmail);
                      return isDev ? 'Unlimited Access' : (user?.subscriptionTier === 'scholar_gold' ? 'Scholar Gold' : user?.subscriptionTier === 'scholar' ? 'Scholar' : 'Free Tier');
                    })()}
                  </div>
                </div>
                <ChevronRight size={isMobile ? 10 : 12} className="opacity-40" />
              </button>
            )}

            {user ? (
              <div className="flex items-center justify-between">
                <div className={cn(
                  "flex items-center",
                  isMobile ? "gap-2" : "gap-2.5"
                )}>
                  <img src={user.photoURL || ''} alt="" className={isMobile ? "w-6 h-6 rounded-full border border-gold/30" : "w-7 h-7 rounded-full border border-gold/30"} />
                  <div className={isMobile ? "text-[10px]" : "text-[11px]"}>
                    <div className="flex items-center gap-1">
                      <p className="font-medium truncate max-w-[100px]">{user.displayName}</p>
                      {(() => {
                        const devEmails = ['yosefahmed1710@gmail.com', 'yosef.elsaid.10@gmail.com'];
                        const currentUserEmail = auth.currentUser?.email?.toLowerCase();
                        return currentUserEmail && devEmails.some(email => email.toLowerCase() === currentUserEmail) && (
                          <span className="bg-gold/20 text-gold text-[6px] px-1 rounded uppercase font-bold">Dev</span>
                        );
                      })()}
                    </div>
                    <button onClick={logout} className="text-gold hover:underline flex items-center gap-1">
                      <LogOut size={isMobile ? 8 : 9} /> {t.logout}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={login}
                className={cn(
                  "flex items-center gap-2 w-full rounded-xl bg-gold text-white font-medium hover:bg-gold-dark transition-all shadow-lg",
                  isMobile ? "p-2 text-[10px]" : "p-2.5 text-xs"
                )}
              >
                <LogIn size={isMobile ? 14 : 16} /> {t.signInToSave}
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative z-10 min-w-0">
        {/* Header */}
        <header className={cn(
          "flex items-center justify-between px-4 border-b border-[var(--border)] glass sticky top-0 z-20",
          isMobile ? "h-14" : "h-16"
        )}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-2 hover:bg-gold/10 rounded-lg text-gold"
            >
              <Menu size={isMobile ? 18 : 20} />
            </button>
          <div className="flex items-center gap-2">
            <Logo className={isMobile ? "w-7 h-7" : "w-8 h-8"} />
            <div className="flex flex-col">
              <h1 className={cn("font-bold tracking-tight text-gold leading-none", isMobile ? "text-base" : "text-lg")}>{t.title}</h1>
              {isKidsMode && <span className="text-[8px] font-bold text-gold uppercase tracking-widest animate-pulse">Kids Mode</span>}
            </div>
          </div>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Kids Mode Toggle */}
            <button
              onClick={() => setIsKidsMode(!isKidsMode)}
              className={cn(
                "p-2 rounded-lg transition-all flex items-center gap-2",
                isKidsMode 
                  ? "bg-gold text-white shadow-lg shadow-gold/20" 
                  : "hover:bg-gold/10 text-gold"
              )}
              title={isKidsMode ? "Kids Mode Active" : "Turn on Kids Mode"}
            >
              <Baby size={isMobile ? 18 : 20} />
              {!isMobile && <span className="text-[10px] font-bold uppercase tracking-tighter">Kids</span>}
            </button>

            {/* Language Selector */}
            <div className="relative" ref={langMenuRef}>
              <button
                onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
                className="p-2 rounded-lg hover:bg-gold/10 text-gold transition-colors flex items-center gap-2"
                aria-label="Change language"
              >
                <Languages size={isMobile ? 18 : 20} />
                <span className="hidden sm:inline text-xs font-medium uppercase">{lang}</span>
              </button>
              
              <AnimatePresence>
                {isLangMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className={cn(
                      "absolute top-full mt-2 w-40 bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl z-50 max-h-[50vh] overflow-y-auto custom-scrollbar glass",
                      lang === 'ar' || lang === 'ur' ? "left-0" : "right-0"
                    )}
                  >
                    <div className="p-0.5 grid grid-cols-1 gap-0">
                      {languages.map((l) => (
                        <button
                          key={l.code}
                          onClick={() => {
                            setLang(l.code);
                            setIsLangMenuOpen(false);
                          }}
                          className={cn(
                            "flex items-center justify-between px-2 py-1 rounded-lg transition-all text-left",
                            lang === l.code 
                              ? "bg-gold/20 text-gold font-bold" 
                              : "hover:bg-gold/5 text-[var(--text)] opacity-80 hover:opacity-100"
                          )}
                        >
                          <div className="flex flex-col items-start leading-tight">
                            <span className="text-[9px] font-bold">{l.nativeName}</span>
                            <span className="text-[7px] opacity-60 uppercase tracking-tighter">{l.name}</span>
                          </div>
                          {lang === l.code && <Check size={8} className="text-gold" />}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button 
              onClick={() => setIsDark(!isDark)}
              className="p-2 rounded-lg hover:bg-gold/10 text-gold transition-colors"
              aria-label="Toggle theme"
            >
              {isDark ? <Sun size={20} /> : <Moon size={20} />}
            </button>

            {currentChatId && user && (
              <button
                onClick={(e) => shareChat(currentChatId, e)}
                className="p-2 rounded-lg hover:bg-gold/10 text-gold transition-colors"
                title="Share this chat"
              >
                <Share2 size={20} />
              </button>
            )}

            {!user && (
              <button onClick={login} className="hidden sm:inline text-xs font-medium text-gold hover:underline">
                {t.signIn}
              </button>
            )}
          </div>
        </header>

        {/* Messages */}
        <div className={cn(
          "flex-1 overflow-y-auto custom-scrollbar",
          isMobile ? "p-3 space-y-4" : "p-4 md:p-6 space-y-8"
        )}>
          <div className="max-w-3xl mx-auto w-full">
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className={cn(
                    "mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 flex flex-col gap-3",
                    isMobile ? "text-xs" : "text-sm"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Info size={16} />
                      <span>{error}</span>
                    </div>
                    <button onClick={() => setError(null)} className="p-1 hover:bg-red-500/10 rounded-lg">
                      <X size={14} />
                    </button>
                  </div>
                  {!hasApiKey && isAiStudio && (
                    <button 
                      onClick={handleSelectKey}
                      className="w-full py-2 rounded-lg bg-red-500 text-white text-xs font-bold hover:bg-red-600 transition-all shadow-lg active:scale-95"
                    >
                      Fix Connection / Use Own Key
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {messages.length === 0 ? (
              <div className={cn(
                "h-full flex flex-col items-center justify-center text-center",
                isMobile ? "space-y-4 py-10" : "space-y-8 py-20"
              )}>
                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="relative"
                >
                  <div className="absolute inset-0 bg-gold/20 rounded-3xl blur-2xl animate-pulse" />
                  <Logo className={isMobile ? "w-20 h-20 relative z-10" : "w-32 h-32 relative z-10"} />
                </motion.div>
                <div className="space-y-3">
                  <h2 className={cn("font-serif italic text-gold", isMobile ? "text-xl" : "text-3xl")}>{t.welcome}</h2>
                  <p className={cn("opacity-70 max-w-md mx-auto leading-relaxed", isMobile ? "text-xs" : "text-sm")}>
                    {t.welcomeDesc}
                  </p>
                </div>
                <div className={cn(
                  "grid grid-cols-1 sm:grid-cols-2 w-full max-w-2xl",
                  isMobile ? "gap-2" : "gap-4"
                )}>
                  {dailyInspiration ? (
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "sm:col-span-2 rounded-3xl border border-gold/30 bg-gold/5 text-left relative overflow-hidden group",
                        isMobile ? "p-4" : "p-6"
                      )}
                    >
                      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Scroll size={isMobile ? 60 : 80} className="text-gold" />
                      </div>
                      <div className={cn(
                        "relative z-10",
                        isMobile ? "space-y-2" : "space-y-4"
                      )}>
                        <div className="flex items-center gap-2 text-gold font-bold text-xs uppercase tracking-widest">
                          <Sparkles size={14} />
                          <span>Daily Inspiration</span>
                        </div>
                        <p className={cn("font-serif italic text-gold leading-relaxed", isMobile ? "text-lg" : "text-xl")} dir="rtl">
                          {dailyInspiration.arabic}
                        </p>
                        <p className={cn("opacity-80 leading-relaxed italic", isMobile ? "text-xs" : "text-sm")}>
                          "{dailyInspiration.translation}"
                        </p>
                        <div className="flex items-center justify-between pt-2 border-t border-gold/10">
                          <span className="text-[10px] font-bold opacity-40 uppercase">{dailyInspiration.citation}</span>
                          <button 
                            onClick={() => setInput(dailyInspiration.text)}
                            className="text-[10px] font-bold text-gold hover:underline uppercase tracking-tighter"
                          >
                            Ask about this →
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <button
                      onClick={() => setInput("Give me a daily inspiration from the Quran or Sunnah with a short reflection.")}
                      className={cn(
                        "sm:col-span-2 group flex items-center justify-center gap-3 rounded-2xl border border-gold/30 bg-gold/10 hover:bg-gold/20 text-gold transition-all shadow-lg shadow-gold/5",
                        isMobile ? "p-3" : "p-4"
                      )}
                    >
                      <Sparkles size={isMobile ? 18 : 20} className="animate-pulse" />
                      <span className={cn("font-bold uppercase tracking-wider", isMobile ? "text-xs" : "text-sm")}>Daily Inspiration</span>
                    </button>
                  )}
                  {shuffledSuggestions.map((suggestion: string) => (
                    <button
                      key={suggestion}
                      onClick={() => setInput(suggestion)}
                      className={cn(
                        "group flex items-center justify-between rounded-2xl border border-[var(--border)] hover:bg-gold/5 text-left transition-all hover:border-gold/50 bg-[var(--card)]/30",
                        isMobile ? "p-3" : "p-4"
                      )}
                    >
                      <span className={cn("font-medium opacity-80 group-hover:opacity-100", isMobile ? "text-xs" : "text-sm")}>{suggestion}</span>
                      <div className="text-gold opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                        <ChevronRight size={16} className={lang === 'ar' || lang === 'ur' ? "rotate-180" : ""} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className={cn(
                "pb-10",
                isMobile ? "space-y-4" : "space-y-8"
              )}>
                {messages.map((message) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "flex",
                      isMobile ? "gap-2" : "gap-4",
                      message.role === 'user' ? "flex-row-reverse" : "flex-row"
                    )}
                  >
                    <div className={cn(
                      "rounded-lg shrink-0 flex items-center justify-center shadow-sm",
                      isMobile ? "w-6 h-6" : "w-8 h-8",
                      message.role === 'user' ? "bg-gold text-white" : "bg-[var(--card)] text-gold border border-gold/20"
                    )}>
                      {message.role === 'user' ? <UserIcon size={isMobile ? 12 : 16} /> : <Book size={isMobile ? 12 : 16} />}
                    </div>
                    <div className={cn(
                      "max-w-[85%] space-y-2",
                      message.role === 'user' ? "text-right" : "text-left"
                    )}>
                      {message.role === 'model' && message.mood && (
                        <div className="flex items-center gap-2 px-1 mb-1">
                          <span className="text-[10px] uppercase tracking-widest font-bold text-gold/60">
                            Mood: {message.mood}
                          </span>
                        </div>
                      )}
                      
                      {message.role === 'model' && message.correctedPrompt && message.correctedPrompt !== 'none' && (
                        <div className="p-2 rounded-xl bg-blue-500/5 border border-blue-500/10 mb-2 text-[10px] text-blue-500/80 flex items-center gap-2">
                          <Info size={12} />
                          <span>Did you mean: <span className="font-bold italic">"{message.correctedPrompt}"</span>?</span>
                        </div>
                      )}

                      {message.role === 'model' && message.summary && (
                        <div className="p-3 rounded-2xl bg-gold/5 border border-gold/20 mb-2 italic text-xs text-gold/80 leading-relaxed">
                          <div className="flex items-center gap-2 mb-1">
                            <Sparkles size={12} />
                            <span className="font-bold uppercase tracking-tighter text-[10px]">Quick Summary</span>
                          </div>
                          {message.summary}
                        </div>
                      )}

                      <div className={cn(
                        "inline-block rounded-2xl shadow-sm markdown-body leading-relaxed relative group/msg",
                        isMobile ? "p-3 text-xs" : "p-4 text-sm",
                        message.role === 'user' 
                          ? "bg-gold text-white rounded-tr-none" 
                          : "bg-[var(--card)] text-[var(--text)] border border-[var(--border)] rounded-tl-none"
                      )}>
                        <ReactMarkdown>{message.text}</ReactMarkdown>
                        
                        {message.links && message.links.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-gold/10 space-y-2">
                            <p className="text-[10px] uppercase tracking-widest font-bold text-gold/60 flex items-center gap-2">
                              <MapPin size={12} /> Nearby Places
                            </p>
                            <div className="flex flex-col gap-2">
                              {message.links.map((link, i) => (
                                <a 
                                  key={i} 
                                  href={link.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="flex items-center justify-between p-2 rounded-lg bg-gold/5 hover:bg-gold/10 border border-gold/10 text-xs text-gold transition-all"
                                >
                                  <span>{link.title}</span>
                                  <ExternalLink size={12} />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {message.role === 'model' && message.wordAnalysis && message.wordAnalysis.length > 0 && (
                        <div className="mt-2 p-3 rounded-2xl bg-gold/5 border border-gold/10 space-y-2">
                          <div className="flex items-center gap-2 mb-1 opacity-60">
                            <BookOpen size={12} className="text-gold" />
                            <span className="font-bold uppercase tracking-tighter text-[10px]">Word Analysis</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {message.wordAnalysis.map((word, i) => (
                              <div key={i} className="px-2 py-1 rounded-lg bg-gold/10 border border-gold/20 text-[10px] flex flex-col">
                                <span className="font-bold text-gold font-serif text-sm" dir="rtl">{word.word}</span>
                                <span className="opacity-70">{word.meaning}</span>
                                {word.root && <span className="text-[8px] opacity-40 italic">Root: {word.root}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {message.role === 'model' && (
                        <div className="flex items-center gap-2 px-1">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(message.text);
                            }}
                            className="p-1.5 rounded-lg hover:bg-gold/10 text-gold/60 hover:text-gold transition-all flex items-center gap-1.5 text-[10px] font-medium"
                            title={t.copy}
                          >
                            <Copy size={12} />
                            {t.copy}
                          </button>
                          
                          {message.references && message.references.length > 0 && (
                            <button
                              onClick={() => {
                                const msgEl = document.getElementById(`refs-${message.id}`);
                                if (msgEl) msgEl.classList.toggle('hidden');
                              }}
                              className="p-1.5 rounded-lg hover:bg-gold/10 text-gold/60 hover:text-gold transition-all flex items-center gap-1.5 text-[10px] font-medium"
                            >
                              <BookOpen size={12} />
                              {t.references}
                            </button>
                          )}

                          <button
                            onClick={() => speak(message.text, message.id)}
                            className={cn(
                              "p-1.5 rounded-lg transition-all flex items-center gap-1.5 text-[10px] font-medium",
                              isSpeaking === message.id 
                                ? "bg-gold/20 text-gold" 
                                : "hover:bg-gold/10 text-gold/60 hover:text-gold"
                            )}
                          >
                            {isSpeaking === message.id ? <VolumeX size={12} /> : <Volume2 size={12} />}
                            {isSpeaking === message.id ? "Stop" : "Listen"}
                          </button>

                          {message.text.length > 500 && (
                            <button
                              onClick={() => setInput(`Summarize this for me: ${message.text.slice(0, 500)}...`)}
                              className="p-1.5 rounded-lg hover:bg-gold/10 text-gold/60 hover:text-gold transition-all flex items-center gap-1.5 text-[10px] font-medium"
                            >
                              <Sparkles size={12} />
                              Summarize
                            </button>
                          )}
                        </div>
                      )}

                      {message.role === 'model' && message.relatedQuestions && message.relatedQuestions.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          {message.relatedQuestions.map((q, i) => (
                            <button
                              key={i}
                              onClick={() => setInput(q)}
                              className="px-3 py-1.5 rounded-full bg-gold/5 border border-gold/20 text-[10px] text-gold hover:bg-gold/10 transition-all"
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      )}

                      {message.role === 'model' && message.references && message.references.length > 0 && (
                        <div id={`refs-${message.id}`} className="hidden mt-2 space-y-2">
                          {message.references.map((ref, idx) => {
                            const url = getReferenceUrl(ref);
                            return (
                              <div key={idx} className="p-3 rounded-xl bg-gold/5 border border-gold/10 text-xs space-y-2">
                                <div className="flex items-center justify-between opacity-60">
                                  <span className="uppercase tracking-tighter font-bold">{ref.type}</span>
                                  {url ? (
                                    <a 
                                      href={url} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="hover:text-gold hover:underline flex items-center gap-1 transition-all"
                                    >
                                      {ref.citation}
                                      <ExternalLink size={10} />
                                    </a>
                                  ) : (
                                    <span>{ref.citation}</span>
                                  )}
                                </div>
                                {ref.arabic && (
                                  <p className="text-right font-serif text-sm leading-loose" dir="rtl">{ref.arabic}</p>
                                )}
                                {ref.translation && (
                                  <p className="opacity-80 italic leading-relaxed">{ref.translation}</p>
                                )}
                                {ref.type.toLowerCase() === 'quran' && (
                                  <button
                                    onClick={() => {
                                      const match = ref.citation.match(/(\d+):(\d+)/);
                                      if (match) {
                                        playAyahAudio(match[1], match[2], message.id);
                                      }
                                    }}
                                    className={cn(
                                      "mt-2 flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-[10px] font-bold uppercase tracking-tighter",
                                      (() => {
                                        const match = ref.citation.match(/(\d+):(\d+)/);
                                        const key = match ? `${match[1]}:${match[2]}-${message.id}` : '';
                                        return playingAyah === key;
                                      })()
                                        ? "bg-gold text-white shadow-lg shadow-gold/20"
                                        : "bg-gold/10 text-gold hover:bg-gold/20"
                                    )}
                                  >
                                    <Volume2 size={12} className={(() => {
                                      const match = ref.citation.match(/(\d+):(\d+)/);
                                      const key = match ? `${match[1]}:${match[2]}-${message.id}` : '';
                                      return playingAyah === key;
                                    })() ? "animate-pulse" : ""} />
                                    {(() => {
                                      const match = ref.citation.match(/(\d+):(\d+)/);
                                      const key = match ? `${match[1]}:${match[2]}-${message.id}` : '';
                                      return playingAyah === key;
                                    })() ? "Playing..." : "Maher Al-Muaiqly"}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {message.timestamp && (
                        <p className="text-[10px] opacity-40 px-1">
                          {format(message.timestamp.toDate ? message.timestamp.toDate() : new Date(), 'HH:mm')}
                        </p>
                      )}
                    </div>
                  </motion.div>
                ))}
                
                {isLoading && (
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-lg bg-[var(--card)] text-gold border border-gold/20 flex items-center justify-center">
                      <Book size={16} />
                    </div>
                    <div className="bg-[var(--card)] rounded-2xl rounded-tl-none p-4 border border-[var(--border)] shadow-sm">
                      <div className="flex gap-1.5">
                        <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="w-2 h-2 bg-gold rounded-full" />
                        <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-2 h-2 bg-gold rounded-full" />
                        <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-2 h-2 bg-gold rounded-full" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <footer className="p-4 border-t border-[var(--border)] glass relative z-20">
          <div className="max-w-3xl mx-auto">
            {!hasApiKey && isAiStudio && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 p-4 rounded-2xl bg-gold/10 border border-gold/20 flex flex-col sm:flex-row items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gold/20 flex items-center justify-center text-gold">
                    <Sparkles size={20} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-gold">Connection Setup</h4>
                    <p className="text-xs opacity-70">Click the button to finish setting up your Hidaya assistant.</p>
                  </div>
                </div>
                <button
                  onClick={handleSelectKey}
                  className="px-6 py-2 rounded-xl bg-gold text-white text-sm font-bold hover:bg-gold-dark transition-all shadow-lg active:scale-95 whitespace-nowrap"
                >
                  Fix Connection
                </button>
              </motion.div>
            )}
            {attachments.length > 0 && (
              <div className={cn(
                "flex flex-wrap gap-2 mb-3 px-2",
                isMobile ? "mb-2" : "mb-3"
              )}>
                {attachments.map((att, idx) => (
                  <div key={idx} className="relative group">
                    <div className={cn(
                      "rounded-xl overflow-hidden border border-gold/20 bg-gold/5",
                      isMobile ? "w-12 h-12" : "w-16 h-16"
                    )}>
                      {att.file.type.startsWith('image/') ? (
                        <img src={att.preview} alt="preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-gold/60 gap-1 p-1">
                          <FileIcon size={isMobile ? 16 : 20} />
                          <span className="text-[8px] truncate w-full text-center">{att.file.name}</span>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttachment(idx)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-30"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleSubmit} className="relative group">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                multiple
                accept="image/*,application/pdf,text/*"
              />
              <div className="absolute inset-0 bg-gold/5 rounded-2xl blur-xl group-focus-within:bg-gold/10 transition-all pointer-events-none" />
              
              <div className={cn(
                "relative flex items-end gap-2 bg-[var(--card)] border border-gold/30 rounded-2xl shadow-sm focus-within:border-gold/50 focus-within:ring-2 focus-within:ring-gold/20 transition-all z-10",
                isMobile ? "p-1.5" : "p-2"
              )}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!user && isAuthReady}
                  className={cn(
                    "rounded-xl hover:bg-gold/10 text-gold/60 hover:text-gold transition-all disabled:opacity-30",
                    isMobile ? "p-2" : "p-3"
                  )}
                  title="Attach file"
                >
                  <Paperclip size={isMobile ? 18 : 20} />
                </button>

                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={user ? t.placeholder : t.signInPlaceholder}
                  disabled={!user && isAuthReady}
                  className={cn(
                    "flex-1 bg-transparent border-none focus:ring-0 resize-none max-h-32 min-h-[44px] placeholder:opacity-50 custom-scrollbar",
                    isMobile ? "p-2 text-xs" : "p-3 text-sm"
                  )}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  rows={1}
                />

                <div className="flex items-center gap-1 mb-1 mr-1">
                  <button
                    type="button"
                    onClick={toggleRecording}
                    disabled={!user && isAuthReady}
                    className={cn(
                      "rounded-xl transition-all disabled:opacity-30",
                      isMobile ? "p-2" : "p-3",
                      isRecording 
                        ? "bg-red-500 text-white animate-pulse" 
                        : "hover:bg-gold/10 text-gold/60 hover:text-gold"
                    )}
                    title="Voice input"
                  >
                    <Mic size={isMobile ? 18 : 20} />
                  </button>

                  <button
                    type="submit"
                    disabled={(!input.trim() && attachments.length === 0) || isLoading || (!user && isAuthReady)}
                    className={cn(
                      "rounded-xl bg-gold text-white hover:bg-gold-dark transition-all shadow-lg active:scale-95 disabled:opacity-30 disabled:scale-100",
                      isMobile ? "p-2" : "p-3"
                    )}
                  >
                    {isLoading ? <Loader2 size={isMobile ? 18 : 20} className="animate-spin" /> : <Send size={isMobile ? 18 : 20} className={lang === 'ar' || lang === 'ur' ? "rotate-180" : ""} />}
                  </button>
                </div>
              </div>
            </form>
            <div className="mt-4 flex flex-col items-center gap-1">
              {isAiStudio && (
                <button 
                  onClick={handleSelectKey}
                  className="text-[10px] text-gold/60 hover:text-gold transition-colors mb-1 underline underline-offset-2"
                >
                  Change API Key
                </button>
              )}
              <p className="text-[10px] opacity-60 flex items-center gap-1 font-medium">
                <Info size={10} className="text-gold" /> {t.disclaimer}
              </p>
              <p className="text-[9px] opacity-40 italic">
                {t.aiMistake}
              </p>
            </div>
          </div>
        </footer>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(212, 175, 55, 0.2);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(212, 175, 55, 0.4);
        }
        .rtl { direction: rtl; }
        .ltr { direction: ltr; }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        .group-hover\:bounce:hover {
          animation: bounce 0.5s ease infinite;
        }
      `}</style>
    </div>
    </ErrorBoundary>
  );
}
