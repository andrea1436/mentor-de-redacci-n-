/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { 
  BookOpen, 
  Send, 
  Sparkles, 
  AlertCircle, 
  CheckCircle2, 
  ArrowRight,
  GraduationCap,
  MapPin,
  History,
  Languages
} from 'lucide-react';

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

interface FeedbackItem {
  error: string;
  sugerencia: string;
  explicacion: string;
}

interface EvaluationResult {
  saludo: string;
  retroalimentacion: FeedbackItem[];
  consejoOro: string;
}

export default function App() {
  const [essay, setEssay] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleEvaluate = async () => {
    if (!essay.trim()) return;
    
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [{ text: essay }]
          }
        ],
        config: {
          systemInstruction: `Actúa como un Experto en Lingüística y Redacción Pedagógica, con una especialidad en el acompañamiento de estudiantes de secundaria (grado 7.º) en contextos rurales. Tu tono debe ser siempre cercano, motivador y empático, celebrando la identidad cultural del estudiante mientras corriges con precisión técnica.

OBJETIVO: Evaluar y proporcionar retroalimentación constructiva a ensayos cortos (máximo 3 párrafos o una hoja) escritos por estudiantes. Tu meta es mejorar la calidad textual sin desincentivar la expresión libre del alumno.

CONTEXTO:
- Audiencia: Estudiantes de la Institución Educativa Retiro de los Indios (Cereté, Córdoba).
- Temática: Identidad cultural, tradiciones y relatos locales.
- Restricciones: Los estudiantes tienen libertad de lenguaje (pueden usar regionalismos), pero deben aprender a estructurarlos formalmente.

DELIMITADORES DE SEGURIDAD:
- Solo evalúa textos que parezcan ensayos o relatos. 
- Si el texto no tiene sentido o no es un ensayo/relato, usa el campo 'saludo' para pedir amablemente al estudiante que intente explicar su idea de nuevo o que escriba sobre sus tradiciones, y deja 'retroalimentacion' como una lista vacía.

ACCIONES:
1. Lee el ensayo completo e identifica el tema cultural principal.
2. Analiza la Estructura: ¿Tiene introducción, desarrollo y conclusión?
3. Revisa la Gramática y Ortografía: Detecta errores de tildes, mayúsculas y puntuación.
4. Evalúa la Coherencia y Cohesión: ¿Las ideas fluyen o están aisladas?
5. Mitigación de sesgos: No penalices el uso de palabras locales o dialectos; en su lugar, sugiere cómo integrarlos en un texto académico.

SALIDA (JSON):
- saludo: Un breve comentario (máx. 50 palabras) que resalte algo positivo del contenido o la historia que el estudiante contó. Si el texto no es válido, úsalo para orientar al estudiante.
- retroalimentacion: Una lista de objetos con 'error', 'sugerencia' y 'explicacion'.
- consejoOro: Una sugerencia final para mejorar la estructura del ensayo (Introducción, Desarrollo o Conclusión) de forma sencilla.`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              saludo: { type: Type.STRING },
              retroalimentacion: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    error: { type: Type.STRING },
                    sugerencia: { type: Type.STRING },
                    explicacion: { type: Type.STRING }
                  },
                  required: ["error", "sugerencia", "explicacion"]
                }
              },
              consejoOro: { type: Type.STRING }
            },
            required: ["saludo", "retroalimentacion", "consejoOro"]
          }
        }
      });

      const text = response.text;
      if (text) {
        setResult(JSON.parse(text));
      }
    } catch (err) {
      console.error("Error evaluating essay:", err);
      setError("Lo siento, hubo un problema al evaluar tu ensayo. Por favor, intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto">
      {/* Header */}
      <motion.header 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12"
      >
        <div className="flex justify-center mb-4">
          <div className="bg-warm-accent/10 p-3 rounded-2xl">
            <GraduationCap className="w-10 h-10 text-warm-accent" />
          </div>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold text-warm-accent mb-2">Escriba</h1>
        <p className="text-warm-muted max-w-lg mx-auto">
          Mentor de Redacción para la Institución Educativa Retiro de los Indios
        </p>
        <div className="flex items-center justify-center gap-4 mt-4 text-xs font-medium uppercase tracking-widest text-warm-accent/60">
          <span className="flex items-center gap-1"><MapPin size={14} /> Cereté, Córdoba</span>
          <span className="w-1 h-1 bg-warm-accent/30 rounded-full"></span>
          <span className="flex items-center gap-1"><History size={14} /> Tradición Local</span>
        </div>
      </motion.header>

      <main className="w-full space-y-8">
        {/* Input Section */}
        <motion.section 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="warm-card p-6 md:p-8"
        >
          <div className="flex items-center gap-2 mb-4 text-warm-accent">
            <BookOpen size={20} />
            <h2 className="text-xl font-semibold">Escribe tu ensayo o relato</h2>
          </div>
          <p className="text-sm text-warm-muted mb-4">
            Cuéntanos sobre tus tradiciones, tu identidad o alguna historia de tu comunidad. 
            (Máximo 3 párrafos)
          </p>
          <textarea
            value={essay}
            onChange={(e) => setEssay(e.target.value)}
            placeholder="En mi pueblo, Retiro de los Indios, la tradición de..."
            className="input-field min-h-[200px] text-lg leading-relaxed resize-none"
            disabled={loading}
          />
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleEvaluate}
              disabled={loading || !essay.trim()}
              className="accent-button flex items-center gap-2"
            >
              {loading ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  >
                    <Sparkles size={20} />
                  </motion.div>
                  Evaluando...
                </>
              ) : (
                <>
                  <Send size={20} />
                  Enviar para revisión
                </>
              )}
            </button>
          </div>
        </motion.section>

        {/* Error Message */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-red-50 border border-red-100 text-red-700 p-4 rounded-2xl flex items-start gap-3"
            >
              <AlertCircle className="shrink-0 mt-0.5" size={20} />
              <p>{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results Section */}
        <AnimatePresence>
          {result && (
            <motion.section
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8 pb-12"
            >
              {/* Saludo */}
              <div className="warm-card p-6 md:p-8 border-l-4 border-l-warm-accent">
                <div className="flex items-center gap-2 mb-4 text-warm-accent">
                  <Sparkles size={20} />
                  <h3 className="text-lg font-semibold uppercase tracking-wider">Comentario del Mentor</h3>
                </div>
                <p className="serif-text text-2xl italic text-warm-accent/90 leading-relaxed">
                  "{result.saludo}"
                </p>
              </div>

              {/* Feedback Table */}
              <div className="warm-card overflow-hidden">
                <div className="p-6 border-b border-black/5 flex items-center gap-2 text-warm-accent">
                  <Languages size={20} />
                  <h3 className="text-lg font-semibold">Retroalimentación Técnica</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-warm-accent/5 text-warm-accent/70 text-xs uppercase tracking-widest">
                        <th className="px-6 py-4 font-semibold">Error detectado</th>
                        <th className="px-6 py-4 font-semibold">Sugerencia</th>
                        <th className="px-6 py-4 font-semibold">¿Por qué?</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5">
                      {result.retroalimentacion.length > 0 ? (
                        result.retroalimentacion.map((item, idx) => (
                          <motion.tr 
                            key={idx}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.1 }}
                            className="hover:bg-warm-accent/[0.02] transition-colors"
                          >
                            <td className="px-6 py-4 font-medium text-red-600/80">{item.error}</td>
                            <td className="px-6 py-4 font-medium text-green-700/80">{item.sugerencia}</td>
                            <td className="px-6 py-4 text-sm text-warm-muted leading-relaxed">{item.explicacion}</td>
                          </motion.tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={3} className="px-6 py-12 text-center text-warm-muted italic">
                            <div className="flex flex-col items-center gap-2">
                              <CheckCircle2 className="text-green-500" size={32} />
                              ¡Excelente trabajo! No se detectaron errores técnicos importantes.
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Consejo de Oro */}
              <div className="warm-card p-6 md:p-8 bg-warm-accent text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-10">
                  <Sparkles size={120} />
                </div>
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-4 opacity-80">
                    <ArrowRight size={20} />
                    <h3 className="text-sm font-bold uppercase tracking-[0.2em]">Consejo de Oro</h3>
                  </div>
                  <p className="text-xl md:text-2xl font-serif leading-relaxed">
                    {result.consejoOro}
                  </p>
                </div>
              </div>

              {/* Reset Button */}
              <div className="flex justify-center pt-4">
                <button 
                  onClick={() => {
                    setResult(null);
                    setEssay("");
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="text-warm-accent/60 hover:text-warm-accent text-sm font-medium flex items-center gap-2 transition-colors"
                >
                  Escribir un nuevo ensayo
                </button>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      <footer className="mt-auto pt-12 text-center text-warm-muted text-xs">
        <p>© 2026 Institución Educativa Retiro de los Indios</p>
        <p className="mt-1">Cereté, Córdoba - Colombia</p>
      </footer>
    </div>
  );
}
