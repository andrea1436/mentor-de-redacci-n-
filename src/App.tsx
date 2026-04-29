/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { FileText, BookOpen, Brain, ImagePlus, User as UserIcon, LogOut, ChevronRight, Sparkles, SpellCheck, Network, Layers, Link as LinkIcon, Eye, HelpCircle, History } from 'lucide-react';
import { collection, addDoc, serverTimestamp, getDocFromServer, doc, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db, auth } from './firebase';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "" });

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface ObservationItem {
  num: number;
  parrafo: string;
  fragmento: string;
  categoria: string;
  errorIdentificado: string;
  explicacion: string;
  correccionSugerida: string;
}

interface CategorySummary {
  categoria: string;
  cantidad: number;
}

interface ScoreDimension {
  desempeño: string; // Superior, Alto, Básico, Bajo
  comentario: string;
}

interface ScoreBreakdown {
  tesis: ScoreDimension;
  argumentacion: ScoreDimension;
  coherencia: ScoreDimension;
  estructura: ScoreDimension;
  ortografia: ScoreDimension;
}

interface CriterionAnalysis {
  analisis: string;
  ejemplos: string[];
  mejoras: string;
}

interface EvaluationResult {
  id?: string;
  nombreEstudiante: string;
  tituloEnsayo: string;
  grado: string;
  fecha: string;
  transcripcionExacta: string;
  observacionesDetalladas: ObservationItem[];
  resumenCategorias: CategorySummary[];
  desempeñoGlobal: string; 
  justificacionGlobal: string;
  desglose: ScoreBreakdown;
  analisisCriterios: {
    ortografia_letras: CriterionAnalysis;
    puntuacion: CriterionAnalysis;
    estructura: CriterionAnalysis;
    conectores: CriterionAnalysis;
    claridad: CriterionAnalysis;
    sustentacion: CriterionAnalysis;
  };
  recomendaciones: string;
  nivelEnsayo: string;
  createdAt?: any;
  uid?: string;
}

type View = 'revision' | 'biblioteca';

export default function App() {
  const [essay, setEssay] = useState("");
  const [studentName, setStudentName] = useState("");
  const [grade, setGrade] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [currentView, setCurrentView] = useState<View>('revision');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [savedEssays, setSavedEssays] = useState<EvaluationResult[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });

    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) {
      setSavedEssays([]);
      return;
    }

    const q = query(
      collection(db, 'essays'),
      where('uid', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribeEssays = onSnapshot(q, (snapshot) => {
      const essays = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as EvaluationResult[];
      setSavedEssays(essays);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'essays');
    });

    return () => unsubscribeEssays();
  }, [user]);

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setError(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setError("No se pudo iniciar sesión. Intenta de nuevo.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => signOut(auth);

  const fileToGenerativePart = async (file: File) => {
    return new Promise<{ inlineData: { data: string, mimeType: string } }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Data = (reader.result as string).split(",")[1];
        resolve({ inlineData: { data: base64Data, mimeType: file.type } });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => setFilePreview(reader.result as string);
        reader.readAsDataURL(file);
      } else {
        setFilePreview(null);
      }
    }
  };

  const handleEvaluate = async () => {
    if (!essay.trim() && !selectedFile) {
      setError("Escribe algo o sube un archivo.");
      return;
    }
    if (!user) { handleLogin(); return; }
    if (!studentName.trim() || !grade.trim()) {
      setError("Completa tus datos primero.");
      return;
    }
    
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const parts: any[] = [{ text: `Estudiante: ${studentName}\nGrado: ${grade}\nEnsayo:\n${essay}` }];
      if (selectedFile) {
        const filePart = await fileToGenerativePart(selectedFile);
        parts.push(filePart);
      }

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: `Actúa como un Mentor Académico Estricto para la I.E. RETIRO DE LOS INDIOS (Grado 9). 
          Tu misión es evaluar ensayos de forma estrictamente CUALITATIVA usando: Superior (S), Alto (A), Básico (B), Bajo (BJ). 
          PROHIBIDO usar números o porcentajes. El tono debe ser formal, académico y motivacional.

          Para el "Análisis Detallado" por criterio (analisisCriterios), para cada uno de los 6 puntos debes:
          - Analizar profundamente el estado del texto.
          - Liste ejemplos específicos (citas) del ensayo.
          - Sugerir una ruta de mejora clara.

          Los 6 criterios son:
          1. Aspectos ortográficos: Tildes y uso correcto de grafemas (b/v, c/s/z, etc).
          2. Puntuación y mayúsculas: Uso de comas, puntos y signos de expresión.
          3. Estructura: Calidad de Introducción (tesis), Desarrollo y Conclusión.
          4. Conectores: Variedad y pertinencia lógica de los nexos.
          5. Claridad: Coherencia, evitar redundancias y ambigüedad.
          6. Argumentación: Solidez, evidencias y ejemplos que sustentan la tesis.

          En 'observacionesDetalladas', identifica errores puntuales, explica POR QUÉ es un error y cómo corregirlo.`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              nombreEstudiante: { type: Type.STRING },
              tituloEnsayo: { type: Type.STRING },
              grado: { type: Type.STRING },
              fecha: { type: Type.STRING },
              transcripcionExacta: { type: Type.STRING },
              observacionesDetalladas: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    num: { type: Type.NUMBER },
                    parrafo: { type: Type.STRING },
                    fragmento: { type: Type.STRING },
                    categoria: { type: Type.STRING },
                    errorIdentificado: { type: Type.STRING },
                    explicacion: { type: Type.STRING },
                    correccionSugerida: { type: Type.STRING }
                  },
                  required: ["num", "parrafo", "fragmento", "categoria", "errorIdentificado", "explicacion", "correccionSugerida"]
                }
              },
              resumenCategorias: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    categoria: { type: Type.STRING },
                    cantidad: { type: Type.NUMBER }
                  },
                  required: ["categoria", "cantidad"]
                }
              },
              desempeñoGlobal: { type: Type.STRING },
              justificacionGlobal: { type: Type.STRING },
              desglose: {
                type: Type.OBJECT,
                properties: {
                  tesis: { type: Type.OBJECT, properties: { desempeño: { type: Type.STRING }, comentario: { type: Type.STRING } }, required: ["desempeño", "comentario"] },
                  argumentacion: { type: Type.OBJECT, properties: { desempeño: { type: Type.STRING }, comentario: { type: Type.STRING } }, required: ["desempeño", "comentario"] },
                  coherencia: { type: Type.OBJECT, properties: { desempeño: { type: Type.STRING }, comentario: { type: Type.STRING } }, required: ["desempeño", "comentario"] },
                  estructura: { type: Type.OBJECT, properties: { desempeño: { type: Type.STRING }, comentario: { type: Type.STRING } }, required: ["desempeño", "comentario"] },
                  ortografia: { type: Type.OBJECT, properties: { desempeño: { type: Type.STRING }, comentario: { type: Type.STRING } }, required: ["desempeño", "comentario"] }
                },
                required: ["tesis", "argumentacion", "coherencia", "estructura", "ortografia"]
              },
              analisisCriterios: {
                type: Type.OBJECT,
                properties: {
                  ortografia_letras: { type: Type.OBJECT, properties: { analisis: { type: Type.STRING }, ejemplos: { type: Type.ARRAY, items: { type: Type.STRING } }, mejoras: { type: Type.STRING } }, required: ["analisis", "ejemplos", "mejoras"] },
                  puntuacion: { type: Type.OBJECT, properties: { analisis: { type: Type.STRING }, ejemplos: { type: Type.ARRAY, items: { type: Type.STRING } }, mejoras: { type: Type.STRING } }, required: ["analisis", "ejemplos", "mejoras"] },
                  estructura: { type: Type.OBJECT, properties: { analisis: { type: Type.STRING }, ejemplos: { type: Type.ARRAY, items: { type: Type.STRING } }, mejoras: { type: Type.STRING } }, required: ["analisis", "ejemplos", "mejoras"] },
                  conectores: { type: Type.OBJECT, properties: { analisis: { type: Type.STRING }, ejemplos: { type: Type.ARRAY, items: { type: Type.STRING } }, mejoras: { type: Type.STRING } }, required: ["analisis", "ejemplos", "mejoras"] },
                  claridad: { type: Type.OBJECT, properties: { analisis: { type: Type.STRING }, ejemplos: { type: Type.ARRAY, items: { type: Type.STRING } }, mejoras: { type: Type.STRING } }, required: ["analisis", "ejemplos", "mejoras"] },
                  sustentacion: { type: Type.OBJECT, properties: { analisis: { type: Type.STRING }, ejemplos: { type: Type.ARRAY, items: { type: Type.STRING } }, mejoras: { type: Type.STRING } }, required: ["analisis", "ejemplos", "mejoras"] }
                },
                required: ["ortografia_letras", "puntuacion", "estructura", "conectores", "claridad", "sustentacion"]
              },
              recomendaciones: { type: Type.STRING },
              nivelEnsayo: { type: Type.STRING }
            },
            required: ["nombreEstudiante", "tituloEnsayo", "grado", "fecha", "transcripcionExacta", "observacionesDetalladas", "resumenCategorias", "desempeñoGlobal", "justificacionGlobal", "desglose", "analisisCriterios", "recomendaciones", "nivelEnsayo"]
          }
        }
      });

      const parsedResult: EvaluationResult = JSON.parse(response.text);
      setResult(parsedResult);

      await addDoc(collection(db, 'essays'), {
        ...parsedResult,
        uid: user.uid,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      setError("Error en la evaluación. Reintenta.");
    } finally {
      setLoading(false);
    }
  };

  const filteredEssays = savedEssays.filter(e => 
    e.nombreEstudiante.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.tituloEnsayo.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen selection:bg-primary/20 selection:text-on-background">
      <header className="fixed top-0 w-full z-50 px-6 py-4">
        <div className="max-w-7xl mx-auto rounded-2xl border border-white/20 bg-white/40 backdrop-blur-xl shadow-lg grid grid-cols-3 items-center px-6 py-2">
          <div className="flex items-center gap-3">
            <h3 className="font-headline text-2xl font-bold tracking-tighter text-slate-900 leading-tight">Escriba</h3>
            <div className="hidden lg:flex flex-col border-l border-slate-200 pl-3">
              <p className="font-label text-[9px] uppercase font-bold tracking-widest text-slate-500">I.E. Retiro de los Indios</p>
              <p className="font-label text-[7px] uppercase font-bold tracking-[0.2em] text-cyan-600">Ciencia y Trabajo</p>
            </div>
          </div>
          <div className="flex justify-center items-center">
            <div className="h-16 w-auto flex items-center justify-center cursor-default transition-all duration-500 hover:scale-105 active:scale-95 bg-white/40 backdrop-blur-sm rounded-2xl px-4 py-2 border border-white/50 shadow-sm">
              <img 
                src="/escudo.png" 
                alt="Logo I.E. Retiro de los Indios" 
                className="h-full w-auto object-contain drop-shadow-md"
                onError={(e) => { (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=IERI&background=f7d800&color=0056b3&bold=true&size=128'; }}
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-8 text-xs uppercase font-bold tracking-widest font-label">
            <nav className="hidden md:flex gap-10">
              <button 
                onClick={() => setCurrentView('biblioteca')} 
                className={`transition-all duration-300 relative group flex items-center gap-2 ${currentView === 'biblioteca' ? 'text-primary' : 'text-slate-400 hover:text-slate-900'}`}
              >
                <BookOpen className="w-4 h-4" />
                <span>Biblioteca</span>
                {currentView === 'biblioteca' && <motion.div layoutId="nav-glow" className="absolute -bottom-2 left-0 w-full h-0.5 bg-primary rounded-full shadow-[0_0_8px_rgba(0,229,255,0.6)]" />}
              </button>
              <button 
                onClick={() => { setCurrentView('revision'); setResult(null); }} 
                className={`transition-all duration-300 relative group flex items-center gap-2 ${currentView === 'revision' ? 'text-primary' : 'text-slate-400 hover:text-slate-900'}`}
              >
                <Brain className="w-4 h-4" />
                <span>Mentor</span>
                {currentView === 'revision' && <motion.div layoutId="nav-glow" className="absolute -bottom-2 left-0 w-full h-0.5 bg-primary rounded-full shadow-[0_0_8px_rgba(0,229,255,0.6)]" />}
              </button>
            </nav>
            {user ? (
               <div className="flex items-center gap-4 border-l pl-8 border-slate-200">
                  <img src={user.photoURL || ""} className="w-8 h-8 rounded-full border-2 border-primary/20 shadow-sm" alt="User" />
                  <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 transition-colors lowercase font-medium tracking-normal flex items-center gap-1">
                    <LogOut className="w-3 h-3" />
                    <span>salir</span>
                  </button>
               </div>
            ) : (
               <button onClick={handleLogin} className="px-6 py-2.5 bg-slate-900 text-white rounded-xl shadow-lg hover:bg-slate-800 active:scale-95 transition-all">Entrar</button>
            )}
          </div>
        </div>
      </header>

      <main className="pt-32 pb-32 px-4 max-w-5xl mx-auto">
        {currentView === 'revision' ? (
          <>
            <section className="mb-20 text-center relative py-8">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-primary/5 rounded-full blur-[100px] -z-10"></div>
              <div className="space-y-4">
                <span className="font-label text-slate-400 font-bold uppercase tracking-[0.6em] text-[10px] block opacity-80 animate-fade-in">Laboratorio de Escritura Académica</span>
                <h1 className="font-headline text-6xl md:text-8xl font-black text-slate-900 uppercase tracking-tighter">Escriba</h1>
                <div className="flex items-center justify-center gap-4">
                  <div className="h-px w-10 bg-slate-200"></div>
                  <p className="font-label text-[11px] font-bold uppercase tracking-[0.4em] text-cyan-600">Ciencia y Trabajo</p>
                  <div className="h-px w-10 bg-slate-200"></div>
                </div>
              </div>
            </section>

            {!result && (
              <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-[3rem] p-10 md:p-16 shadow-2xl border border-slate-100">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                  <div className="space-y-2">
                    <label className="font-label text-[10px] uppercase font-bold text-slate-400 tracking-widest">Estudiante</label>
                    <input value={studentName} onChange={e => setStudentName(e.target.value)} className="input-field" placeholder="Nombre completo" />
                  </div>
                  <div className="space-y-2">
                    <label className="font-label text-[10px] uppercase font-bold text-slate-400 tracking-widest">Grado</label>
                    <input value={grade} onChange={e => setGrade(e.target.value)} className="input-field" placeholder="Ej: 9-1" />
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 mb-10">
                   <div className="lg:col-span-2">
                      <textarea value={essay} onChange={e => setEssay(e.target.value)} className="input-field min-h-[400px]" placeholder="Escribe tu ensayo aquí..." />
                   </div>
                   <div className="space-y-8">
                      <div className="border-2 border-dashed border-slate-200 rounded-3xl p-10 text-center cursor-pointer hover:bg-slate-50 transition-colors flex flex-col items-center justify-center gap-4" onClick={() => document.getElementById('f')?.click()}>
                         <input type="file" id="f" className="hidden" onChange={handleFileChange} />
                         {selectedFile ? (
                           <div className="flex flex-col items-center gap-2">
                             <FileText className="w-10 h-10 text-primary" />
                             <p className="font-label text-xs font-bold text-slate-900 truncate max-w-[150px]">{selectedFile.name}</p>
                           </div>
                         ) : (
                           <>
                             <ImagePlus className="w-12 h-12 text-slate-300 mb-2" />
                             <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Adjuntar Foto o PDF</p>
                           </>
                         )}
                      </div>
                      <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 italic text-xs text-slate-500 relative">
                         <div className="absolute top-0 right-0 p-2 opacity-10">
                           <Sparkles className="w-8 h-8" />
                         </div>
                         "La claridad en tu expresión es el reflejo de la claridad en tu pensamiento."
                      </div>
                   </div>
                </div>
                <div className="flex justify-between items-center border-t pt-8">
                   <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none">IERI • {new Date().getFullYear()}</p>
                   <button onClick={handleEvaluate} disabled={loading} className="px-12 py-4 bg-slate-900 text-white rounded-2xl font-bold uppercase text-xs tracking-widest hover:bg-slate-800 disabled:opacity-30">
                      {loading ? 'Analizando...' : user ? 'Enviar revisión' : 'Entrar para enviar'}
                   </button>
                </div>
              </motion.section>
            )}

            <AnimatePresence>
              {result && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-24 mt-24">
                  <section className="text-center space-y-4">
                    <span className="font-label text-slate-500 font-bold uppercase tracking-widest text-[10px]">Reporte de Desempeño</span>
                    <h2 className="font-headline text-4xl md:text-5xl font-black text-slate-900 leading-tight">"{result.tituloEnsayo}"</h2>
                    <div className="flex justify-center gap-6 text-xs font-bold tracking-widest text-slate-400">
                      <p>{result.nombreEstudiante}</p>
                      <p>{result.grado}</p>
                      <p>{result.fecha}</p>
                    </div>
                  </section>

                  <section className="space-y-8">
                     <div className="bg-slate-50 p-10 rounded-[3rem] border border-slate-100 font-body text-lg text-slate-700 leading-relaxed italic whitespace-pre-wrap">
                        {result.transcripcionExacta}
                     </div>
                  </section>

                  <section className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                     <div className="bg-slate-900 text-white p-12 rounded-[3.5rem] shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-[100px]"></div>
                        <div className="relative z-10 flex flex-col h-full">
                           <div className="flex justify-between items-end mb-12">
                              <div className="space-y-4">
                                 <p className="font-label text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Desempeño Global</p>
                                 <h3 className="font-headline text-6xl font-black tracking-tighter text-primary uppercase">{result.desempeñoGlobal}</h3>
                                 <p className="font-body text-xs text-slate-300 leading-relaxed max-w-xs">{result.justificacionGlobal}</p>
                              </div>
                              <div className="text-right">
                                 <p className="font-label text-[10px] font-bold text-white uppercase tracking-widest">{result.nivelEnsayo}</p>
                              </div>
                           </div>
                           <div className="space-y-8 flex-1">
                              {Object.entries(result.desglose).map(([k, v]: [string, any], i) => (
                                <div key={i} className="space-y-2 group/item">
                                   <div className="flex justify-between text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">
                                      <span>{k}</span>
                                      <span className="text-primary">{v.desempeño}</span>
                                   </div>
                                   <p className="text-[10px] text-slate-500 leading-relaxed opacity-0 group-hover/item:opacity-100 transition-opacity duration-300 h-0 group-hover/item:h-auto overflow-hidden">
                                      {v.comentario}
                                   </p>
                                   <div className="h-0.5 bg-white/10 rounded-full overflow-hidden">
                                      <motion.div 
                                        initial={{ width: 0 }} 
                                        animate={{ width: v.desempeño === 'Superior' ? '100%' : v.desempeño === 'Alto' ? '75%' : v.desempeño === 'Básico' ? '50%' : '25%' }} 
                                        transition={{ duration: 1, delay: i * 0.1 }} 
                                        className="h-full bg-primary" 
                                      />
                                   </div>
                                </div>
                              ))}
                           </div>
                           <button onClick={() => { setResult(null); setEssay(""); }} className="mt-12 w-full py-4 bg-white text-slate-900 rounded-2xl font-bold uppercase text-[10px] tracking-widest">Nueva Revisión</button>
                        </div>
                     </div>

                     <div className="space-y-8">
                        <div className="bg-white border p-10 rounded-[3rem] shadow-sm relative overflow-hidden">
                           <div className="w-12 h-12 rounded-2xl bg-secondary/10 flex items-center justify-center text-secondary mb-6"><Brain className="w-6 h-6" /></div>
                           <h4 className="font-headline font-bold text-2xl text-slate-900 mb-4">Recomendaciones</h4>
                           <p className="font-body text-slate-600 leading-relaxed italic">{result.recomendaciones}</p>
                        </div>
                        <div className="bg-white border p-10 rounded-[3rem] shadow-sm">
                           <h4 className="font-headline font-bold text-xl text-slate-900 mb-6 font-bold">Mapa de Hallazgos</h4>
                           <div className="flex flex-wrap gap-3">
                              {result.resumenCategorias.map((c, i) => (
                                <div key={i} className="px-4 py-2 bg-slate-50 rounded-xl border text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-3">
                                   {c.categoria} <span className="text-primary font-black">{c.cantidad}</span>
                                </div>
                              ))}
                           </div>
                        </div>
                     </div>
                  </section>

                  <section className="space-y-12">
                     <div className="flex flex-col items-center gap-2">
                       <h3 className="font-headline text-3xl font-black text-slate-900 uppercase tracking-tighter">Análisis Detallado</h3>
                       <div className="h-1 w-20 bg-primary rounded-full"></div>
                     </div>
                     
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {result.analisisCriterios && Object.entries(result.analisisCriterios).map(([key, data]: [string, any], idx) => (
                           <motion.div 
                              key={key}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: idx * 0.1 }}
                              className="bg-white border border-slate-100 p-8 rounded-[2.5rem] shadow-sm hover:shadow-xl transition-all group"
                           >
                              <div className="flex items-center gap-4 mb-6">
                                 <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-primary group-hover:bg-slate-900 group-hover:text-white transition-colors">
                                    {key === 'ortografia_letras' ? <SpellCheck className="w-6 h-6" /> : 
                                     key === 'puntuacion' ? <SpellCheck className="w-6 h-6" /> :
                                     key === 'estructura' ? <Layers className="w-6 h-6" /> :
                                     key === 'conectores' ? <LinkIcon className="w-6 h-6" /> :
                                     key === 'claridad' ? <Eye className="w-6 h-6" /> : <Brain className="w-6 h-6" />}
                                 </div>
                                 <h4 className="font-headline font-bold text-xl text-slate-900 uppercase tracking-tight">
                                    {key.replace('_', ' ').replace('ortografia letras', 'Ortografía').replace('puntuacion', 'Puntuación').replace('sustentacion', 'Argumentos')}
                                 </h4>
                              </div>
                              
                              <div className="space-y-6">
                                 <div>
                                    <p className="font-label text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Evaluación del Mentor</p>
                                    <p className="font-body text-sm text-slate-600 leading-relaxed italic border-l-2 border-slate-100 pl-4">
                                       {data.analisis}
                                    </p>
                                 </div>

                                 {data.ejemplos && data.ejemplos.length > 0 && (
                                    <div>
                                       <p className="font-label text-[10px] font-bold text-red-400 uppercase tracking-widest mb-2">Evidencias Detectadas</p>
                                       <div className="space-y-2">
                                          {data.ejemplos.map((ex: string, i: number) => (
                                             <div key={i} className="bg-red-50/50 p-3 rounded-xl border border-red-100/50 text-[13px] italic text-red-700">
                                                "{ex}"
                                             </div>
                                          ))}
                                       </div>
                                    </div>
                                 )}

                                 <div className="bg-primary/5 p-5 rounded-2xl border border-primary/10">
                                    <div className="flex items-center gap-2 mb-2 text-primary">
                                       <Sparkles className="w-3 h-3" />
                                       <p className="font-label text-[10px] font-bold uppercase tracking-widest">Sugerencia de Mejora</p>
                                    </div>
                                    <p className="font-headline font-bold text-sm text-slate-900 leading-tight">
                                       {data.mejoras}
                                    </p>
                                 </div>
                              </div>
                           </motion.div>
                        ))}
                     </div>
                  </section>

                  <section className="space-y-10">
                     <div className="flex flex-col items-center gap-2">
                       <h3 className="font-headline text-2xl font-black text-slate-900 uppercase tracking-tighter">Hallazgos Puntuales</h3>
                       <p className="font-body text-xs text-slate-400">Explicación detallada de errores específicos encontrados en el texto.</p>
                     </div>

                     <div className="grid grid-cols-1 gap-4">
                        {result.observacionesDetalladas.map((o, idx) => (
                           <motion.div 
                              key={idx}
                              initial={{ opacity: 0, x: -5 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.8 + (idx * 0.05) }}
                              className="bg-white border border-slate-100 p-6 rounded-3xl shadow-sm flex flex-col md:flex-row gap-6 relative overflow-hidden group"
                           >
                              <div className="absolute top-0 left-0 w-1 h-full bg-slate-100 group-hover:bg-primary transition-colors"></div>
                              <div className="md:w-1/3 space-y-3">
                                 <div className="flex items-center gap-2">
                                    <span className="w-6 h-6 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-[10px]">{o.num}</span>
                                    <span className="font-label text-[8px] font-bold text-slate-400 uppercase tracking-widest">Párrafo {o.parrafo}</span>
                                 </div>
                                 <div className="bg-red-50/50 p-3 rounded-2xl border border-red-100/50">
                                    <p className="font-body text-[13px] italic text-red-700 leading-snug">"{o.fragmento}"</p>
                                 </div>
                              </div>
                              <div className="flex-1 space-y-2">
                                 <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[8px] font-black uppercase tracking-widest">{o.categoria}</span>
                                    <h5 className="font-bold text-slate-900 text-sm">{o.errorIdentificado}</h5>
                                 </div>
                                 <p className="text-[13px] text-slate-500 leading-relaxed"><strong className="text-slate-900 font-bold">Explicación:</strong> {o.explicacion}</p>
                                 <div className="pt-2">
                                    <p className="font-headline font-bold text-slate-900 text-[13px] text-primary">Sugerencia: <span className="text-slate-900">"{o.correccionSugerida}"</span></p>
                                 </div>
                              </div>
                           </motion.div>
                        ))}
                     </div>
                  </section>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        ) : (
          <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-16">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-10">
               <div>
                  <span className="font-label text-slate-400 font-bold uppercase tracking-[0.4em] text-[10px] block">Archivo Académico</span>
                  <h1 className="font-headline text-5xl md:text-6xl font-black text-slate-900 uppercase">Biblioteca</h1>
               </div>
               <div className="relative w-full md:w-[400px]">
                  <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full px-8 py-4 rounded-2xl border border-slate-100 shadow-sm outline-none focus:ring-4 focus:ring-primary/10 transition-all font-label text-sm" placeholder="Buscar estudiante o título..." />
               </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               {filteredEssays.map((e, i) => (
                  <div key={i} onClick={() => { setResult(e); setCurrentView('revision'); }} className="bg-white border p-10 rounded-[3rem] shadow-sm hover:shadow-2xl transition-all cursor-pointer group relative overflow-hidden">
                     <div className="flex justify-between items-start mb-6">
                        <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-primary group-hover:text-slate-900 transition-colors"><FileText className="w-6 h-6" /></div>
                        <p className="font-headline text-2xl font-black text-slate-900 group-hover:text-primary transition-colors uppercase tracking-tight">{e.desempeñoGlobal}</p>
                     </div>
                     <p className="font-label text-[8px] font-bold text-primary uppercase tracking-widest mb-1">{e.grado}</p>
                     <h4 className="font-headline font-bold text-xl text-slate-900 group-hover:underline decoration-primary underline-offset-4 mb-6">"{e.tituloEnsayo}"</h4>
                     <div className="flex justify-between items-center pt-6 border-t border-slate-50">
                        <p className="font-label text-[10px] font-bold text-slate-800">{e.nombreEstudiante}</p>
                        <p className="font-label text-[8px] text-slate-400 uppercase tracking-widest">{e.fecha}</p>
                     </div>
                  </div>
               ))}
            </div>
          </motion.section>
        )}
      </main>
      <nav className="md:hidden fixed bottom-0 left-0 w-full bg-white/80 backdrop-blur-xl border-t border-slate-100 px-6 py-3 flex justify-around items-center z-50 shadow-[0_-8px_32px_rgba(0,0,0,0.05)]">
        <button 
          onClick={() => setCurrentView('biblioteca')} 
          className={`flex flex-col items-center gap-1 transition-all ${currentView === 'biblioteca' ? 'text-primary scale-110' : 'text-slate-300'}`}
        >
          <BookOpen className="w-5 h-5" />
          <span className="font-label text-[8px] font-bold uppercase tracking-widest">Librería</span>
        </button>
        <button 
          onClick={() => { setCurrentView('revision'); setResult(null); }} 
          className={`flex flex-col items-center gap-1 transition-all ${currentView === 'revision' ? 'text-primary scale-110' : 'text-slate-300'}`}
        >
          <div className="w-12 h-12 -mt-8 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-primary/20">
            <FileText className="w-6 h-6" />
          </div>
          <span className="font-label text-[8px] font-bold uppercase tracking-widest text-slate-400">Mentor</span>
        </button>
        <button 
          onClick={() => setCurrentView('biblioteca')} 
          className="flex flex-col items-center gap-1 text-slate-300"
        >
          <UserIcon className="w-5 h-5" />
          <span className="font-label text-[8px] font-bold uppercase tracking-widest">Perfil</span>
        </button>
      </nav>
    </div>
  );
}
