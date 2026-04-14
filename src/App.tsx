/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
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

interface EvaluationResult {
  id?: string;
  nombreEstudiante: string;
  tituloEnsayo: string;
  grado: string;
  fecha: string;
  observacionesDetalladas: ObservationItem[];
  resumenCategorias: CategorySummary[];
  mensajeMotivacion: string;
  puntuacion: number;
  createdAt?: any;
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
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Login error:", err);
      setError("No se pudo iniciar sesión con Google.");
    }
  };

  const handleLogout = () => signOut(auth);

  const handleEvaluate = async () => {
    if (!essay.trim() || !studentName.trim() || !grade.trim() || !user) return;
    
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [{ text: `Estudiante: ${studentName}\nGrado: ${grade}\nEnsayo:\n${essay}` }]
          }
        ],
        config: {
          systemInstruction: `Actúa como un Experto en Lingüística y Redacción Pedagógica, con una especialidad en el acompañamiento de estudiantes de secundaria (grado 9.º, 14-15 años) en contextos rurales. Tu tono debe ser siempre cercano, motivador y empático, celebrando la identidad cultural del estudiante mientras corriges con precisión técnica.

OBJETIVO: Analizar ensayos o relatos y generar retroalimentación estructurada en una tabla detallada para estudiantes de grado 9.

ACCIONES:
1. Analiza el texto meticulosamente, "letra por letra", reconociendo cada coma, punto y tilde.
2. Identifica errores sutiles y trata de entender la intención del autor si la redacción es confusa.
3. Clasifica CADA observación en una de estas 6 categorías EXACTAS:
   - Aspectos ortográficos
   - Ortografía y puntuación
   - Estructura del ensayo
   - Uso de conectores
   - Claridad de ideas
   - Sustentación de argumentos

REGLAS PARA LA TABLA:
- Párrafo: Indica "Párrafo X" o "Línea X".
- Fragmento: Cita el texto original EXACTO entre comillas.
- Explicación: Explica el "por qué" pedagógico incluyendo la regla gramatical u ortográfica. Usa un lenguaje sencillo y amable.
- Tono: NUNCA uses frases negativas como "cometiste un error"; usa "aquí hay una oportunidad de mejorar". Sé didáctico, nunca condescendiente.

MENSAJE DE MOTIVACIÓN:
- Debe tener entre 3 y 5 oraciones.
- Debe reconocer un aspecto positivo REAL y ESPECÍFICO del texto.
- Debe animar al estudiante a mejorar basándose en los hallazgos.

SALIDA (JSON):
- nombreEstudiante: El nombre del estudiante.
- tituloEnsayo: Título creativo basado en el contenido.
- grado: El grado (9.º).
- fecha: Fecha actual (D/M/AA).
- observacionesDetalladas: Lista de objetos con 'num', 'parrafo', 'fragmento', 'categoria', 'errorIdentificado', 'explicacion', 'correccionSugerida'.
- resumenCategorias: Lista que DEBE incluir las 6 categorías obligatorias mencionadas arriba, cada una con su respectivo conteo (usa 0 si no hay observaciones en esa categoría).
- mensajeMotivacion: El mensaje de 3-5 oraciones.
- puntuacion: Del 1 al 100.`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              nombreEstudiante: { type: Type.STRING },
              tituloEnsayo: { type: Type.STRING },
              grado: { type: Type.STRING },
              fecha: { type: Type.STRING },
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
              mensajeMotivacion: { type: Type.STRING },
              puntuacion: { type: Type.NUMBER }
            },
            required: ["nombreEstudiante", "tituloEnsayo", "grado", "fecha", "observacionesDetalladas", "resumenCategorias", "mensajeMotivacion", "puntuacion"]
          }
        }
      });

      const text = response.text;
      if (text) {
        const parsedResult: EvaluationResult = JSON.parse(text);
        setResult(parsedResult);

        // Save to Firestore
        try {
          await addDoc(collection(db, 'essays'), {
            ...parsedResult,
            ensayoOriginal: essay,
            uid: auth.currentUser?.uid,
            createdAt: serverTimestamp()
          });
        } catch (fsError) {
          handleFirestoreError(fsError, OperationType.WRITE, 'essays');
        }
      }
    } catch (err) {
      console.error("Error evaluating essay:", err);
      setError("Lo siento, hubo un problema al evaluar tu ensayo o guardar los datos. Por favor, intenta de nuevo.");
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
            <a className="font-label text-[13px] font-semibold uppercase tracking-wider text-on-background/60 hover:text-primary transition-colors" href="#">Lienzo</a>
            <button 
              onClick={() => { setCurrentView('revision'); setResult(null); }}
              className={`font-label text-[13px] font-semibold uppercase tracking-wider transition-colors ${currentView === 'revision' ? 'text-primary font-bold' : 'text-on-background/60 hover:text-primary'}`}
            >
              Revisión
            </button>
            <a className="font-label text-[13px] font-semibold uppercase tracking-wider text-on-background/60 hover:text-primary transition-colors" href="#">Mentor</a>
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
                  <textarea
                    value={essay}
                    onChange={(e) => setEssay(e.target.value)}
                    placeholder="Escribe aquí tu ensayo sobre tradiciones, relatos locales o identidad cultural..."
                    className="input-field min-h-[300px] mb-6"
                    disabled={loading}
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={handleEvaluate}
                      disabled={loading || !essay.trim() || !studentName.trim() || !grade.trim() || !user}
                      className="px-8 py-3 satin-gradient text-on-primary rounded-lg font-label font-bold text-sm hover:opacity-90 transition-all flex items-center gap-2 disabled:opacity-50"
                    >
                      {loading ? (
                        <>
                          <span className="material-symbols-outlined animate-spin">sync</span>
                          Analizando...
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined">send</span>
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

                  {/* Summary Table */}
                  <section className="max-w-md mx-auto space-y-6">
                    <div className="flex items-center justify-between px-2">
                      <h3 className="font-headline text-xl font-bold tracking-tight">Resumen de observaciones</h3>
                    </div>
                    <div className="overflow-hidden bg-surface-container rounded-xl border border-outline-variant/10">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-surface-container-high">
                            <th className="p-4 font-label text-xs font-bold uppercase tracking-widest text-outline">Categoría</th>
                            <th className="p-4 font-label text-xs font-bold uppercase tracking-widest text-outline text-center">Cantidad</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-outline-variant/20">
                          {result.resumenCategorias.map((item, idx) => (
                            <tr key={idx} className="hover:bg-surface-container-low transition-colors">
                              <td className="p-4 font-body text-sm text-on-surface">{item.categoria}</td>
                              <td className="p-4 font-label text-sm text-on-surface text-center font-bold">{item.cantidad}</td>
                            </tr>
                          ))}
                          <tr className="bg-primary/5">
                            <td className="p-4 font-label text-sm text-primary font-bold">TOTAL</td>
                            <td className="p-4 font-label text-sm text-primary text-center font-bold">
                              {result.resumenCategorias.reduce((acc, curr) => acc + curr.cantidad, 0)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {/* Motivation Message */}
                  <section>
                    <div className="bg-surface-container-lowest canvas-shadow rounded-xl p-8 md:p-12 relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-1 h-full satin-gradient"></div>
                      <div className="flex items-start gap-6">
                        <div className="hidden sm:block">
                          <div className="w-16 h-16 rounded-full bg-secondary-container flex items-center justify-center">
                            <span className="material-symbols-outlined text-secondary text-3xl">rocket_launch</span>
                          </div>
                        </div>
                        <div className="flex-1">
                          <h2 className="font-headline text-2xl font-bold mb-4 text-primary">💪 Mensaje de motivación</h2>
                          <div className="space-y-4 text-lg leading-relaxed text-on-surface italic">
                            <p>{result.mensajeMotivacion}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Score and Reset */}
                  <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2 bg-surface-container-low p-8 rounded-xl border border-outline-variant/10 flex flex-col justify-between">
                      <div>
                        <h4 className="font-headline text-xl font-bold mb-2">¿Listo para la versión final?</h4>
                        <p className="font-body text-on-surface-variant italic mb-6">Aplica estos cambios y solicita una nueva revisión de estilo.</p>
                      </div>
                      <div className="flex flex-wrap gap-4">
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
                    </div>
                    <div className="bg-primary-container p-8 rounded-xl text-on-primary-container relative overflow-hidden flex flex-col justify-center">
                      <div className="absolute -right-4 -bottom-4 opacity-10">
                        <span className="material-symbols-outlined text-[120px]" style={{ fontVariationSettings: "'FILL' 1" }}>auto_stories</span>
                      </div>
                      <p className="font-label text-xs font-bold uppercase tracking-[0.3em] mb-4">Puntuación Estimada</p>
                      <div className="flex items-baseline gap-2">
                        <span className="font-headline text-6xl font-extrabold tracking-tighter">{result.puntuacion}</span>
                        <span className="font-headline text-2xl opacity-60">/ 100</span>
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
                        <span className="material-symbols-outlined">description</span>
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
                        <p className="font-headline text-2xl font-black text-primary">{item.puntuacion}<span className="text-xs opacity-40">/100</span></p>
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
        <a className="flex flex-col items-center justify-center text-on-background/50" href="#">
          <span className="material-symbols-outlined">edit_note</span>
          <span className="font-label text-[11px] font-semibold uppercase tracking-wider mt-1">Lienzo</span>
        </a>
        <button 
          onClick={() => { setCurrentView('revision'); setResult(null); }}
          className={`flex flex-col items-center justify-center ${currentView === 'revision' ? 'text-primary' : 'text-on-background/50'}`}
        >
          <span className="material-symbols-outlined" style={{ fontVariationSettings: currentView === 'revision' ? "'FILL' 1" : "" }}>forum</span>
          <span className="font-label text-[11px] font-semibold uppercase tracking-wider mt-1">Revisión</span>
        </button>
        <a className="flex flex-col items-center justify-center text-on-background/50" href="#">
          <span className="material-symbols-outlined">school</span>
          <span className="font-label text-[11px] font-semibold uppercase tracking-wider mt-1">Mentor</span>
        </a>
      </nav>
    </div>
  );
}
