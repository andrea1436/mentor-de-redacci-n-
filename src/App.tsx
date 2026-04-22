/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { collection, addDoc, serverTimestamp, getDocFromServer, doc, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db, auth } from './firebase';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User } from 'firebase/auth';

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
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

interface ScoreBreakdown {
  tesis: number;
  argumentacion: number;
  coherencia: number;
  estructura: number;
  ortografia: number;
  pensamientoCritico: number;
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
  puntuacion: number; // Escala 0-5.0
  desglose: ScoreBreakdown;
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
  
  // File state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  
  // Library state
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

  // Sync Library with Firestore
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
      console.error("Login error:", err);
      
      if (err.code === 'auth/popup-blocked') {
        setError("El navegador bloqueó la ventana emergente. Por favor, permite las ventanas emergentes para este sitio e intenta de nuevo.");
      } else if (err.code === 'auth/cancelled-popup-request') {
        setError("Se canceló la solicitud de inicio de sesión previa. Intenta de nuevo.");
      } else if (err.code === 'auth/popup-closed-by-user') {
        // Just ignore if they closed it manually
      } else if (err.message?.includes('INTERNAL ASSERTION FAILED')) {
        setError("Error interno de autenticación. Por favor, recarga la página e intenta de nuevo.");
      } else {
        setError("No se pudo iniciar sesión con Google. Por favor, intenta de nuevo.");
      }
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
        resolve({
          inlineData: {
            data: base64Data,
            mimeType: file.type,
          },
        });
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
    // Basic content validation first
    if (!essay.trim() && !selectedFile) {
      setError("Por favor, escribe un ensayo o sube un archivo antes de enviar.");
      return;
    }

    // Auth validation
    if (!user) {
      handleLogin();
      return;
    }

    // Metadata validation
    if (!studentName.trim() || !grade.trim()) {
      setError("Por favor, ingresa el nombre del estudiante y el grado.");
      // Scroll to inputs for visibility
      window.scrollTo({ top: 300, behavior: 'smooth' });
      return;
    }
    
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const parts: any[] = [{ text: `Estudiante: ${studentName}\nGrado: ${grade}\nEnsayo (texto proporcionado):\n${essay}` }];
      
      if (selectedFile) {
        const filePart = await fileToGenerativePart(selectedFile);
        parts.push(filePart);
        parts.push({ text: "Analiza también el documento o imagen adjunto para la evaluación." });
      }

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts
          }
        ],
        config: {
          systemInstruction: `Actúa como un Evaluador Académico Formativo, especializado en el desarrollo de habilidades de escritura para estudiantes de secundaria (13-14 años). Tu tono debe ser SERIO, TÉCNICO y PRECISO, pero JUSTO y PROPOSITIVO, entendiendo que el estudiante está en una etapa de aprendizaje.

OBJETIVO: Calificar ensayos en una escala de 0 a 5.0, evaluando la calidad académica bajo estándares claros pero adecuados para la edad.

CONTEXTO DEL TRABAJO:
- Se espera un ensayo de aproximadamente una página (32 líneas). Ten esto en cuenta al evaluar la profundidad y el desarrollo de ideas.

ACCIÓN CRÍTICA (TRANSCRIPCIÓN): 
- Si se proporciona una imagen o PDF, transcribe EXACTAMENTE lo que está escrito línea por línea, sin ninguna corrección ("sic").

CRITERIOS DE EVALUACIÓN (Equilibrio entre rigor y pedagogía):
1. Tesis (1.0 pto): ¿Existe una idea central clara? Penaliza si es inexistente o muy vaga.
2. Argumentación (1.0 pto): ¿Desarrolla sus ideas con lógica? Premia la conexión de ideas sobre la complejidad extrema.
3. Coherencia y Cohesión (1.0 pto): Uso de conectores y orden.
4. Estructura (1.0 pto): Presencia de Introducción, Desarrollo y Conclusión.
5. Ortografía y Gramática (1.0 pto): Identifica errores pero ofrece la regla para que aprenda.

REGLAS DE CALIFICACIÓN:
- Sé exigente con la estructura y la lógica, pero valora la originalidad y el pensamiento crítico propio de un adolescente.
- No regales nota, pero asegúrate de que el estudiante entienda CÓMO llegar al 5.0.
- Puntuación máxima: 5.0.

SALIDA (JSON):
- nombreEstudiante: Nombre completo.
- tituloEnsayo: Título creativo o del original.
- grado: El grado del estudiante.
- fecha: Fecha actual.
- transcripcionExacta: Transcripción fiel línea por línea.
- observacionesDetalladas: Lista de errores específicos e indicaciones de mejora enfocadas en el aprendizaje.
- resumenCategorias: Resumen por categorías de errores.
- puntuacion: Calificación final de 0 a 5.0 (un solo decimal).
- desglose: Objeto con notas (0-1.0 para cada criterio, sumando hasta 5.0): tesis, argumentacion, coherencia, estructura, ortografia, pensamientoCritico (este último se suma a la nota final para reconocer excelencia, pero el total no debe exceder 5.0).
- recomendaciones: Instrucciones técnicas claras y motivadoras para mejorar.
- nivelEnsayo: Una de estas: "Necesita Refuerzo" (0-2.9), "Aceptable" (3.0-3.7), "Buen Nivel" (3.8-4.4), "Excelente" (4.5-5.0).`,
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
              puntuacion: { type: Type.NUMBER },
              desglose: {
                type: Type.OBJECT,
                properties: {
                  tesis: { type: Type.NUMBER },
                  argumentacion: { type: Type.NUMBER },
                  coherencia: { type: Type.NUMBER },
                  estructura: { type: Type.NUMBER },
                  ortografia: { type: Type.NUMBER },
                  pensamientoCritico: { type: Type.NUMBER }
                },
                required: ["tesis", "argumentacion", "coherencia", "estructura", "ortografia", "pensamientoCritico"]
              },
              recomendaciones: { type: Type.STRING },
              nivelEnsayo: { type: Type.STRING }
            },
            required: ["nombreEstudiante", "tituloEnsayo", "grado", "fecha", "transcripcionExacta", "observacionesDetalladas", "resumenCategorias", "puntuacion", "desglose", "recomendaciones", "nivelEnsayo"]
          }
        }
      });

      const text = response.text;
      if (text) {
        const parsedResult: EvaluationResult = JSON.parse(text);
        setResult(parsedResult);

        // Save to Firestore
        try {
          const docRef = await addDoc(collection(db, 'essays'), {
            ...parsedResult,
            ensayoOriginal: essay || "(Evaluación basada en archivo adjunto)",
            uid: auth.currentUser?.uid,
            createdAt: serverTimestamp()
          });
          console.log("Evaluación guardada con ID:", docRef.id);
        } catch (fsError) {
          handleFirestoreError(fsError, OperationType.WRITE, 'essays');
        }
      } else {
        throw new Error("No se recibió respuesta del mentor.");
      }
    } catch (err) {
      console.error("Error evaluating essay:", err);
      setError("Lo siento, hubo un problema al evaluar tu ensayo o guardar los datos. Por favor, intenta de nuevo o revisa tu conexión.");
    } finally {
      setLoading(false);
    }
  };

  const filteredEssays = savedEssays.filter(e => 
    e.nombreEstudiante.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.tituloEnsayo.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.grado.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen selection:bg-secondary-container selection:text-on-secondary-container">
      {/* TopAppBar */}
      <header className="fixed top-0 w-full z-50 bg-surface/70 backdrop-blur-md flex justify-between items-center px-6 py-4 border-b border-outline-variant/10">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-primary">menu_book</span>
          <span className="font-headline text-xl font-bold tracking-tighter text-primary">Atheneum Editorial</span>
        </div>
        <div className="flex items-center gap-6">
          <nav className="hidden md:flex gap-8 items-center">
            <button 
              onClick={() => setCurrentView('biblioteca')}
              className={`font-label text-[13px] font-semibold uppercase tracking-wider transition-colors ${currentView === 'biblioteca' ? 'text-primary font-bold' : 'text-on-background/60 hover:text-primary'}`}
            >
              Biblioteca
            </button>
            <button 
              onClick={() => { setCurrentView('revision'); setResult(null); }}
              className={`font-label text-[13px] font-semibold uppercase tracking-wider transition-colors ${currentView === 'revision' ? 'text-primary font-bold' : 'text-on-background/60 hover:text-primary'}`}
            >
              Mentor
            </button>
          </nav>
          
          {user ? (
            <div className="flex items-center gap-3">
              <img src={user.photoURL || ""} alt={user.displayName || ""} className="w-8 h-8 rounded-full border border-primary/20" />
              <button onClick={handleLogout} className="font-label text-[10px] font-bold uppercase tracking-widest text-outline hover:text-error transition-colors">Salir</button>
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="px-4 py-2 bg-primary text-on-primary rounded-lg font-label font-bold text-[11px] uppercase tracking-widest hover:opacity-90 transition-all flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-sm">login</span>
              Entrar
            </button>
          )}
        </div>
      </header>

      <main className="pt-24 pb-32 px-4 max-w-5xl mx-auto">
        {currentView === 'revision' ? (
          <>
            {/* Editorial Header Section */}
            <section className="mb-12 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
              <div>
                <span className="font-label text-primary font-bold uppercase tracking-[0.2em] text-[10px] mb-2 block">Sesión de Revisión</span>
                <h1 className="font-headline text-5xl md:text-6xl font-extrabold tracking-tighter text-on-background">Retroalimentación</h1>
              </div>
              <div className="text-right">
                <p className="font-label text-sm text-outline font-medium italic">Institución Educativa Retiro de los Indios</p>
                <p className="font-label text-xs text-outline/60">{new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              </div>
            </section>

            {/* Auth Warning */}
            <AnimatePresence>
              {!user && isAuthReady && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-8 bg-secondary-container/30 border border-secondary/20 p-6 rounded-xl flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-4">
                    <span className="material-symbols-outlined text-secondary text-3xl">account_circle</span>
                    <div>
                      <h4 className="font-headline font-bold text-on-secondary-container">Inicia sesión para guardar tu progreso</h4>
                      <p className="font-body text-sm text-on-secondary-container/70">Tus revisiones se guardarán automáticamente en tu biblioteca personal.</p>
                    </div>
                  </div>
                  <button 
                    onClick={handleLogin}
                    className="px-6 py-2 bg-secondary text-on-secondary rounded-lg font-label font-bold text-xs uppercase tracking-widest hover:opacity-90 transition-all"
                  >
                    Iniciar Sesión
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Input Section */}
            {!result && (
              <motion.section 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-16"
              >
                <div className="bg-surface-container-lowest canvas-shadow rounded-xl p-8 md:p-12 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full satin-gradient"></div>
                  <h2 className="font-headline text-2xl font-bold mb-6 text-primary">Información del Estudiante</h2>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    <div>
                      <label className="block font-label text-xs font-bold uppercase tracking-widest text-outline mb-2">Nombre Completo</label>
                      <input 
                        type="text"
                        value={studentName}
                        onChange={(e) => setStudentName(e.target.value)}
                        placeholder="Ej: Saúl Miguel Ortega Peña"
                        className="input-field"
                        disabled={loading}
                      />
                    </div>
                    <div>
                      <label className="block font-label text-xs font-bold uppercase tracking-widest text-outline mb-2">Grado</label>
                      <input 
                        type="text"
                        value={grade}
                        onChange={(e) => setGrade(e.target.value)}
                        placeholder="Ej: 9-1"
                        className="input-field"
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <h2 className="font-headline text-2xl font-bold mb-6 text-primary">Comparte tu historia</h2>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-6">
                    <div className="lg:col-span-2">
                       <label className="block font-label text-xs font-bold uppercase tracking-widest text-outline mb-2">Escribe tu ensayo</label>
                       <textarea
                        value={essay}
                        onChange={(e) => setEssay(e.target.value)}
                        placeholder="Escribe aquí tu ensayo sobre tradiciones, relatos locales o identidad cultural..."
                        className="input-field min-h-[300px]"
                        disabled={loading}
                      />
                    </div>
                    <div className="space-y-6">
                      <label className="block font-label text-xs font-bold uppercase tracking-widest text-outline mb-2">O sube un archivo</label>
                      <div 
                        className={`relative border-2 border-dashed rounded-xl p-8 transition-all flex flex-col items-center justify-center text-center cursor-pointer group ${selectedFile ? 'border-primary/50 bg-primary/5' : 'border-outline-variant/30 hover:border-primary/30 hover:bg-surface-container-low'}`}
                        onClick={() => document.getElementById('file-upload')?.click()}
                      >
                        <input 
                          type="file" 
                          id="file-upload" 
                          className="hidden" 
                          accept="application/pdf,image/*"
                          onChange={handleFileChange}
                        />
                        {filePreview ? (
                          <div className="relative w-full aspect-square rounded-lg overflow-hidden border border-outline-variant/20 mb-4">
                            <img src={filePreview} alt="Vista previa" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <span className="material-symbols-outlined text-white text-3xl">change_circle</span>
                            </div>
                          </div>
                        ) : selectedFile ? (
                          <div className="mb-4">
                            <span className="material-symbols-outlined text-5xl text-primary mb-2">description</span>
                            <p className="font-label text-xs font-bold text-primary truncate max-w-[150px]">{selectedFile.name}</p>
                          </div>
                        ) : (
                          <>
                            <span className="material-symbols-outlined text-5xl text-outline/40 mb-4 group-hover:scale-110 transition-transform">add_a_photo</span>
                            <p className="font-label text-sm text-outline font-medium">Sube una foto de tu cuaderno o un archivo PDF</p>
                            <p className="font-label text-[10px] text-outline/60 mt-2">Formatos: JPG, PNG, PDF</p>
                          </>
                        )}
                        
                        {selectedFile && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedFile(null);
                              setFilePreview(null);
                            }}
                            className="mt-2 text-[10px] font-bold uppercase tracking-widest text-error hover:underline"
                          >
                            Eliminar archivo
                          </button>
                        )}
                      </div>
                      
                      <div className="bg-surface-container-high/50 p-4 rounded-xl">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="material-symbols-outlined text-primary text-sm">info</span>
                          <span className="font-label text-[10px] font-bold uppercase tracking-widest text-primary">Consejo de mentor</span>
                        </div>
                        <p className="font-body text-[11px] text-on-surface-variant leading-relaxed italic">
                          "Si subes una foto, asegúrate de que haya buena luz y que la letra sea clara para poder ayudarte mejor."
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={handleEvaluate}
                      disabled={loading || isLoggingIn || (!essay.trim() && !selectedFile)}
                      className="px-8 py-3 satin-gradient text-on-primary rounded-lg font-label font-bold text-sm hover:opacity-90 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading || isLoggingIn ? (
                        <>
                          <span className="material-symbols-outlined animate-spin">sync</span>
                          {isLoggingIn ? "Iniciando sesión..." : "Analizando..."}
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined">{user ? 'send' : 'login'}</span>
                          {user ? "Enviar para revisión" : "Inicia sesión para enviar"}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </motion.section>
            )}

            {/* Error Message */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-8 bg-error/10 border border-error/20 text-error p-4 rounded-xl flex items-start gap-3"
                >
                  <span className="material-symbols-outlined">error</span>
                  <p className="font-label text-sm font-medium">{error}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Results Section */}
            <AnimatePresence>
              {result && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-16"
                >
                  {/* Header Analysis */}
                  <section className="text-center space-y-4">
                    <p className="font-label text-sm text-on-background/60">Aquí está la retroalimentación completa del ensayo de <strong className="text-primary">{result.nombreEstudiante}</strong>:</p>
                    <div className="h-px w-24 bg-primary/20 mx-auto"></div>
                    <h2 className="font-headline text-3xl font-bold text-primary flex items-center justify-center gap-3">
                      <span className="material-symbols-outlined">description</span>
                      Retroalimentación: "{result.tituloEnsayo}"
                    </h2>
                    <div className="flex justify-center gap-8 text-sm font-label text-outline">
                      <p><strong>Estudiante:</strong> {result.nombreEstudiante}</p>
                      <p><strong>Grado:</strong> {result.grado}</p>
                      <p><strong>Fecha:</strong> {result.fecha}</p>
                    </div>
                  </section>

                  {/* Original Transcription */}
                  <section className="space-y-4">
                    <div className="flex items-center gap-3 px-2">
                      <span className="material-symbols-outlined text-primary">edit_note</span>
                      <h3 className="font-headline text-xl font-bold tracking-tight">Transcripción Exacta (Fiel al original)</h3>
                    </div>
                    <div className="bg-surface-container-lowest p-8 rounded-xl border border-outline-variant/20 relative shadow-inner">
                      <div className="absolute top-4 right-4 text-[10px] uppercase font-label font-bold text-outline opacity-40">Copia fiel (sic)</div>
                      <pre className="font-mono text-sm text-on-surface whitespace-pre-wrap leading-relaxed">
                        {result.transcripcionExacta || "No se generó transcripción."}
                      </pre>
                    </div>
                    <p className="text-[10px] font-label text-outline italic px-2">
                      * Esta transcripción mantiene todos los errores originales del texto para su posterior análisis pedagógico.
                    </p>
                  </section>

                  {/* Detailed Observations Table */}
                  <section className="space-y-6">
                    <div className="flex items-center justify-between px-2">
                      <h3 className="font-headline text-xl font-bold tracking-tight">Tabla de Observaciones</h3>
                      <div className="h-px flex-1 mx-6 bg-outline-variant/20 hidden sm:block"></div>
                    </div>
                    <div className="overflow-hidden bg-surface-container rounded-xl border border-outline-variant/10">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-surface-container-high">
                              <th className="p-4 font-label text-[10px] font-bold uppercase tracking-widest text-outline">#</th>
                              <th className="p-4 font-label text-[10px] font-bold uppercase tracking-widest text-outline">Párrafo</th>
                              <th className="p-4 font-label text-[10px] font-bold uppercase tracking-widest text-outline">Fragmento</th>
                              <th className="p-4 font-label text-[10px] font-bold uppercase tracking-widest text-outline">Categoría</th>
                              <th className="p-4 font-label text-[10px] font-bold uppercase tracking-widest text-outline">Error</th>
                              <th className="p-4 font-label text-[10px] font-bold uppercase tracking-widest text-outline">Explicación</th>
                              <th className="p-4 font-label text-[10px] font-bold uppercase tracking-widest text-outline">Corrección</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-outline-variant/20">
                            {result.observacionesDetalladas.map((item) => (
                              <tr key={item.num} className="hover:bg-surface-container-low transition-colors group">
                                <td className="p-4 align-top font-label text-xs text-outline">{item.num}</td>
                                <td className="p-4 align-top font-label text-xs text-outline whitespace-nowrap">{item.parrafo}</td>
                                <td className="p-4 align-top">
                                  <span className="text-error font-body text-sm italic">"{item.fragmento}"</span>
                                </td>
                                <td className="p-4 align-top">
                                  <span className="text-[10px] font-label text-outline bg-surface-container-high px-2 py-0.5 rounded whitespace-nowrap uppercase">{item.categoria}</span>
                                </td>
                                <td className="p-4 align-top font-body text-sm text-on-surface font-semibold">{item.errorIdentificado}</td>
                                <td className="p-4 align-top">
                                  <p className="font-body text-xs text-on-surface-variant leading-relaxed min-w-[200px]">
                                    {item.explicacion}
                                  </p>
                                </td>
                                <td className="p-4 align-top">
                                  <span className="text-secondary font-body text-sm font-bold">"{item.correccionSugerida}"</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </section>

                  {/* Summary Table replaced by Score Breakdown */}
                  <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-6">
                      <div className="flex items-center justify-between px-2">
                        <h3 className="font-headline text-xl font-bold tracking-tight">Desglose del Puntaje</h3>
                      </div>
                      <div className="bg-surface-container rounded-xl border border-outline-variant/10 p-6 space-y-4">
                        {result.desglose ? [
                          { label: 'Tesis', score: result.desglose.tesis, max: 1 },
                          { label: 'Argumentación', score: result.desglose.argumentacion, max: 1 },
                          { label: 'Coherencia y Cohesión', score: result.desglose.coherencia, max: 1 },
                          { label: 'Estructura', score: result.desglose.estructura, max: 1 },
                          { label: 'Ortografía y Gramática', score: result.desglose.ortografia, max: 1 },
                        ].map((item, idx) => (
                          <div key={idx} className="space-y-1">
                            <div className="flex justify-between text-xs font-label uppercase tracking-widest text-outline">
                              <span>{item.label}</span>
                              <span className="font-bold text-primary">{item.score.toFixed(1)} / {item.max.toFixed(1)}</span>
                            </div>
                            <div className="h-1.5 w-full bg-surface-container-high rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${(item.score / item.max) * 100}%` }}
                                transition={{ duration: 1, delay: idx * 0.1 }}
                                className="h-full satin-gradient"
                              />
                            </div>
                          </div>
                        )) : (
                          <p className="text-sm font-body text-outline italic text-center py-4">Desglose no disponible para evaluaciones antiguas.</p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="flex items-center justify-between px-2">
                        <h3 className="font-headline text-xl font-bold tracking-tight">Resumen de Falencias</h3>
                      </div>
                      <div className="overflow-hidden bg-surface-container rounded-xl border border-outline-variant/10">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-surface-container-high">
                              <th className="p-4 font-label text-xs font-bold uppercase tracking-widest text-outline">Categoría</th>
                              <th className="p-4 font-label text-xs font-bold uppercase tracking-widest text-outline text-center">Cant.</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-outline-variant/20">
                            {result.resumenCategorias.map((item, idx) => (
                              <tr key={idx} className="hover:bg-surface-container-low transition-colors">
                                <td className="p-4 font-body text-sm text-on-surface">{item.categoria}</td>
                                <td className="p-4 font-label text-sm text-on-surface text-center font-bold">{item.cantidad}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </section>

                  {/* Motivation Message replaced by Recomendaciones */}
                  <section>
                    <div className="bg-surface-container-lowest canvas-shadow rounded-xl p-8 md:p-12 relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-1 h-full satin-gradient"></div>
                      <div className="flex items-start gap-6">
                        <div className="hidden sm:block">
                          <div className="w-16 h-16 rounded-full bg-secondary-container flex items-center justify-center">
                            <span className="material-symbols-outlined text-secondary text-3xl">psychology</span>
                          </div>
                        </div>
                        <div className="flex-1">
                          <h2 className="font-headline text-2xl font-bold mb-4 text-primary">📝 Recomendaciones de mejora</h2>
                          <div className="space-y-4 text-lg leading-relaxed text-on-surface">
                            <p className="whitespace-pre-wrap">{result.recomendaciones}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Score and Reset */}
                  <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2 bg-surface-container-low p-8 rounded-xl border border-outline-variant/10 flex items-center justify-between gap-6">
                      <div className="flex-1">
                        <h4 className="font-headline text-xl font-bold mb-2">Nivel del ensayo: <span className="text-secondary">{result.nivelEnsayo}</span></h4>
                        <p className="font-body text-on-surface-variant text-sm italic mb-4">Evaluación bajo estándares académicos rigurosos.</p>
                        <button 
                          onClick={() => {
                            setResult(null);
                            setEssay("");
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="px-8 py-3 satin-gradient text-on-primary rounded-lg font-label font-bold text-sm hover:opacity-90 transition-all flex items-center gap-2"
                        >
                          <span className="material-symbols-outlined">edit</span>
                          Nueva Revisión
                        </button>
                      </div>
                      <div className="hidden sm:block w-px h-24 bg-outline-variant/20"></div>
                      <div className="hidden sm:flex flex-col items-center gap-2 px-6">
                        <span className="material-symbols-outlined text-outline text-4xl">inventory_2</span>
                        <span className="font-label text-[10px] text-outline font-bold uppercase tracking-widest">Registrado</span>
                      </div>
                    </div>
                    <div className="bg-primary-container p-8 rounded-xl text-on-primary-container relative overflow-hidden flex flex-col justify-center">
                      <div className="absolute -right-4 -bottom-4 opacity-10">
                        <span className="material-symbols-outlined text-[120px]" style={{ fontVariationSettings: "'FILL' 1" }}>fact_check</span>
                      </div>
                      <p className="font-label text-xs font-bold uppercase tracking-[0.3em] mb-4">Puntaje Final</p>
                      <div className="flex items-baseline gap-2">
                        <span className="font-headline text-7xl font-extrabold tracking-tighter">{result.puntuacion.toFixed(1)}</span>
                        <span className="font-headline text-2xl opacity-60">/ 5.0</span>
                      </div>
                    </div>
                  </section>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        ) : (
          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-12"
          >
            {/* Library Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <span className="font-label text-primary font-bold uppercase tracking-[0.2em] text-[10px] mb-2 block">Archivo Histórico</span>
                <h1 className="font-headline text-5xl font-extrabold tracking-tighter text-on-background">Biblioteca</h1>
              </div>
              
              {/* Search Bar */}
              <div className="relative w-full md:w-96">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline">search</span>
                <input 
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por estudiante, grado o título..."
                  className="w-full pl-12 pr-4 py-3 bg-surface-container rounded-xl border border-outline-variant/20 font-label text-sm focus:outline-none focus:border-primary transition-all"
                />
              </div>
            </div>

            {/* Essays List */}
            <div className="grid grid-cols-1 gap-4">
              {filteredEssays.length > 0 ? (
                filteredEssays.map((item) => (
                  <motion.div 
                    key={item.id}
                    layout
                    className="bg-surface-container-lowest border border-outline-variant/10 p-6 rounded-xl hover:shadow-lg transition-all cursor-pointer group flex flex-col md:flex-row md:items-center justify-between gap-4"
                    onClick={() => {
                      setResult(item);
                      setCurrentView('revision');
                    }}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-primary/5 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-on-primary transition-colors">
                        <span className="material-symbols-outlined">
                          {item.transcripcionExacta ? 'document_scanner' : 'description'}
                        </span>
                      </div>
                      <div>
                        <h4 className="font-headline font-bold text-lg text-on-background group-hover:text-primary transition-colors">"{item.tituloEnsayo}"</h4>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-label text-outline">
                          <span className="flex items-center gap-1"><span className="material-symbols-outlined text-sm">person</span> {item.nombreEstudiante}</span>
                          <span className="flex items-center gap-1"><span className="material-symbols-outlined text-sm">school</span> {item.grado}</span>
                          <span className="flex items-center gap-1"><span className="material-symbols-outlined text-sm">calendar_today</span> {item.fecha}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="font-label text-[10px] font-bold uppercase tracking-widest text-outline mb-1">Puntuación</p>
                        <p className="font-headline text-2xl font-black text-primary">{item.puntuacion.toFixed(item.puntuacion <= 5 ? 1 : 0)}<span className="text-xs opacity-40">/{item.puntuacion <= 5 ? '5.0' : '100'}</span></p>
                      </div>
                      <span className="material-symbols-outlined text-outline group-hover:translate-x-1 transition-transform">chevron_right</span>
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="text-center py-24 bg-surface-container/30 rounded-2xl border-2 border-dashed border-outline-variant/20">
                  <span className="material-symbols-outlined text-outline/40 text-6xl mb-4">folder_open</span>
                  <p className="font-body text-outline italic">No se encontraron ensayos en tu biblioteca.</p>
                  {searchTerm && <button onClick={() => setSearchTerm("")} className="mt-4 text-primary font-label font-bold text-sm underline">Limpiar búsqueda</button>}
                </div>
              )}
            </div>
          </motion.section>
        )}
      </main>

      {/* BottomNavBar */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full flex justify-around items-center h-20 px-4 pb-safe bg-surface z-50 border-t border-outline-variant/20 shadow-[0px_-4px_16px_rgba(28,28,25,0.04)]">
        <button 
          onClick={() => setCurrentView('biblioteca')}
          className={`flex flex-col items-center justify-center ${currentView === 'biblioteca' ? 'text-primary' : 'text-on-background/50'}`}
        >
          <span className="material-symbols-outlined" style={{ fontVariationSettings: currentView === 'biblioteca' ? "'FILL' 1" : "" }}>auto_stories</span>
          <span className="font-label text-[11px] font-semibold uppercase tracking-wider mt-1">Biblioteca</span>
        </button>
        <button 
          onClick={() => { setCurrentView('revision'); setResult(null); }}
          className={`flex flex-col items-center justify-center ${currentView === 'revision' ? 'text-primary' : 'text-on-background/50'}`}
        >
          <span className="material-symbols-outlined" style={{ fontVariationSettings: currentView === 'revision' ? "'FILL' 1" : "" }}>school</span>
          <span className="font-label text-[11px] font-semibold uppercase tracking-wider mt-1">Mentor</span>
        </button>
      </nav>
    </div>
  );
}
