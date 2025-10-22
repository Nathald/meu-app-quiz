
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { generateQuizAndSummaryFromText, generateSingleQuestionFromText } from './services/geminiService';
import { QuestionState, AnswerStatus, GeminiQuizResponse, PdfRecord, QuizAttempt, QuizQuestion } from './types';
import { MenuIcon, RefreshIcon, UploadIcon, EditIcon, TrashIcon, CheckIcon, PlusIcon, SparklesIcon } from './components/icons';

// --- Custom Hook: useLocalStorage ---
function useLocalStorage<T>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(key);
            if (!item) return initialValue;

            // Synchronous migration logic
            const parsedData = JSON.parse(item) as PdfRecord[];
            let migrationNeeded = false;
            const migratedData = parsedData.map(record => {
                if (record.quiz && Array.isArray(record.quiz)) {
                    let quizChanged = false;
                    const newQuiz = record.quiz.map(q => {
                        // Check for both null and undefined id
                        if (q.id == null) {
                            quizChanged = true;
                            return { ...q, id: crypto.randomUUID() };
                        }
                        return q;
                    });
                    if (quizChanged) {
                        migrationNeeded = true;
                        return { ...record, quiz: newQuiz };
                    }
                }
                return record;
            });

            if (migrationNeeded) {
                console.log("Synchronously migrating old data to include unique question IDs and saving back to localStorage.");
                window.localStorage.setItem(key, JSON.stringify(migratedData));
                return migratedData as unknown as T;
            }
            
            return parsedData as unknown as T;
        } catch (error) {
            console.error(`Error reading or migrating localStorage key “${key}”:`, error);
            return initialValue;
        }
    });

    useEffect(() => {
        try {
            // Only write to localStorage if the value is not the initial value,
            // or if it's an empty array which is a valid state.
            if (storedValue !== initialValue || (Array.isArray(storedValue) && storedValue.length === 0)) {
               window.localStorage.setItem(key, JSON.stringify(storedValue));
            }
        } catch (error) {
            console.error(`Error writing to localStorage key “${key}”:`, error);
        }
    }, [key, storedValue, initialValue]);

    return [storedValue, setStoredValue];
}


// --- Helper: PDF Text Extractor ---
const extractTextFromPdf = async (file: File): Promise<string> => {
    const { pdfjsLib } = window;
    if (!pdfjsLib) {
        throw new Error("PDF.js library is not loaded.");
    }
    const fileReader = new FileReader();
    return new Promise((resolve, reject) => {
        fileReader.onload = async (event) => {
            if (!event.target?.result) {
                return reject(new Error("Failed to read file."));
            }
            try {
                const typedarray = new Uint8Array(event.target.result as ArrayBuffer);
                const pdf = await pdfjsLib.getDocument(typedarray).promise;
                let fullText = "";
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map((item: any) => item.str).join(" ");
                    fullText += pageText + "\n\n";
                }
                resolve(fullText);
            } catch (error) {
                reject(error);
            }
        };
        fileReader.onerror = reject;
        fileReader.readAsArrayBuffer(file);
    });
};

// --- Child Components ---

const FileUpload: React.FC<{ onFileUpload: (file: File) => void; isLoading: boolean; hasRecords: boolean }> = ({ onFileUpload, isLoading, hasRecords }) => (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="max-w-lg w-full">
            <h1 className="text-3xl font-bold text-[#0f3b4d] mb-2">Gerador de Quiz por PDF</h1>
            <p className="text-[#3b6271] mb-8">
                {hasRecords
                    ? "Selecione um material no menu ou faça o upload de um novo PDF para começar."
                    : "Faça o upload de um PDF para gerar um resumo e um quiz personalizado."}
            </p>
            <label htmlFor="pdf-upload" className="relative cursor-pointer bg-white border-2 border-dashed border-gray-300 rounded-lg p-10 flex flex-col items-center justify-center hover:border-[#0f3b4d] transition-colors duration-300">
                <UploadIcon className="w-12 h-12 text-gray-400 mb-4" />
                <span className="text-lg font-semibold text-[#0f3b4d]">Clique para selecionar um PDF</span>
                <span className="text-sm text-gray-500 mt-1">ou arraste e solte o arquivo aqui</span>
                <input id="pdf-upload" type="file" className="sr-only" accept=".pdf" onChange={(e) => e.target.files && onFileUpload(e.target.files[0])} disabled={isLoading} />
            </label>
        </div>
    </div>
);

const LoadingView: React.FC<{ message: string }> = ({ message }) => (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-[#0f3b4d]"></div>
        <p className="mt-6 text-lg font-semibold text-[#3b6271]">{message}</p>
    </div>
);

const QuizCard: React.FC<{ questionState: QuestionState; current: number; total: number; onReveal: () => void; onAnswer: (status: AnswerStatus) => void; onNext: () => void; }> = ({ questionState, current, total, onReveal, onAnswer, onNext }) => {
    const { question, answer, isRevealed, source_questions, status } = questionState;
    const isAnswered = status !== AnswerStatus.UNANSWERED;

    return (
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-8 w-full max-w-2xl mx-auto flex flex-col min-h-[350px]">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-[#0f3b4d]">Quiz de Estudo</h2>
                <span className="text-sm font-medium text-gray-500">Pergunta {current} de {total}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-6">
                <div className="bg-[#0f3b4d] h-2 rounded-full" style={{ width: `${(current / total) * 100}%` }}></div>
            </div>
            <div className="flex-grow">
                <p className="text-lg text-gray-700 leading-relaxed">{question}</p>
                {source_questions && <p className="text-xs text-gray-400 mt-2 italic">{source_questions}</p>}
                {isRevealed && (
                    <div className="mt-6 p-4 bg-[#e0e7e9]/80 rounded-lg border border-gray-200">
                        <p className="text-md text-[#3b6271]">{answer}</p>
                    </div>
                )}
            </div>
            <div className="mt-8">
                {!isRevealed ? (
                    <button onClick={onReveal} className="w-full bg-[#0f3b4d] text-white font-bold py-3 px-4 rounded-lg hover:bg-[#1a5a73] transition-colors duration-300">Revelar Resposta</button>
                ) : (
                    <div className="grid grid-cols-3 gap-4">
                        <button onClick={() => onAnswer(AnswerStatus.INCORRECT)} className={`font-bold py-3 px-4 rounded-lg transition-colors duration-300 ${status === AnswerStatus.INCORRECT ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}>Errei</button>
                        <button onClick={() => onAnswer(AnswerStatus.CORRECT)} className={`font-bold py-3 px-4 rounded-lg transition-colors duration-300 ${status === AnswerStatus.CORRECT ? 'bg-green-600 text-white' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>Acertei</button>
                        <button onClick={onNext} disabled={!isAnswered} className="bg-[#0f3b4d] text-white font-bold py-3 px-4 rounded-lg hover:bg-[#1a5a73] transition-colors duration-300 disabled:bg-gray-400 disabled:cursor-not-allowed">Próxima</button>
                    </div>
                )}
            </div>
        </div>
    );
};

const ResultsView: React.FC<{ attempt: QuizAttempt; totalQuestions: number; onBackToDashboard: () => void; }> = ({ attempt, totalQuestions, onBackToDashboard }) => {
    const correctAnswers = useMemo(() => attempt.answers.filter(a => a === AnswerStatus.CORRECT).length, [attempt]);
    const score = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;

    return (
        <div className="w-full max-w-2xl mx-auto p-4 md:p-8">
            <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-8 text-center">
                <h2 className="text-3xl font-bold text-[#0f3b4d] mb-2">Quiz Concluído!</h2>
                <p className="text-lg text-gray-600 mb-6">Veja seu desempenho nesta tentativa.</p>
                <p className="text-5xl font-bold text-[#0f3b4d] mb-2">{score.toFixed(0)}%</p>
                <p className="text-gray-500">Você acertou {correctAnswers} de {totalQuestions} perguntas.</p>
                <button onClick={onBackToDashboard} className="mt-8 bg-[#0f3b4d] text-white font-bold py-3 px-6 rounded-lg hover:bg-[#1a5a73] transition-colors duration-300">Voltar ao Painel</button>
            </div>
        </div>
    );
};

const QuizEditor: React.FC<{
    quiz: QuizQuestion[];
    onAddQuestion: (question: Omit<QuizQuestion, 'id'>) => void;
    onEditQuestion: (question: QuizQuestion) => void;
    onDeleteQuestion: (questionId: string) => void;
}> = ({ quiz, onAddQuestion, onEditQuestion, onDeleteQuestion }) => {
    const [manualQuestion, setManualQuestion] = useState('');
    const [manualAnswer, setManualAnswer] = useState('');
    const [aiText, setAiText] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);

    const handleSaveManual = () => {
        if (!manualQuestion.trim() || !manualAnswer.trim()) {
            setError("Pergunta e resposta não podem estar vazias.");
            return;
        }
        setError(null);

        if (editingId) {
            const originalQuestion = quiz.find(q => q.id === editingId);
            if (!originalQuestion) return; 
            const questionData: QuizQuestion = {
                id: editingId,
                question: manualQuestion,
                answer: manualAnswer,
                source_questions: originalQuestion.source_questions 
            };
            onEditQuestion(questionData);
        } else {
            const questionData: Omit<QuizQuestion, 'id'> = {
                question: manualQuestion,
                answer: manualAnswer,
                source_questions: 'Adicionado manualmente'
            };
            onAddQuestion(questionData);
        }

        setEditingId(null);
        setManualQuestion('');
        setManualAnswer('');
    };

    const handleGenerateWithAi = async () => {
        if (!aiText.trim()) {
            setError("O texto para a IA não pode estar vazio.");
            return;
        }
        setError(null);
        setIsGenerating(true);
        try {
            const result = await generateSingleQuestionFromText(aiText);
            onAddQuestion({
                ...result,
                source_questions: 'Gerado por IA a partir de texto do usuário'
            });
            setAiText('');
        } catch (err: any) {
            setError(err.message || 'Falha ao gerar pergunta.');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleStartEdit = (id: string) => {
        const q = quiz.find(q => q.id === id);
        if (q) {
            setEditingId(id);
            setManualQuestion(q.question);
            setManualAnswer(q.answer);
        }
    };
    
    const handleDelete = (id: string) => {
        if (window.confirm("Tem certeza que deseja apagar esta pergunta?")) {
            onDeleteQuestion(id);
        }
    }

    const handleCancelEdit = () => {
        setEditingId(null);
        setManualQuestion('');
        setManualAnswer('');
    };

    return (
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-8">
            <h3 className="text-2xl font-bold text-[#0f3b4d] mb-4">Editor do Quiz</h3>
            {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
            <div className="grid md:grid-cols-2 gap-8">
                {/* AI Generation */}
                <div className="space-y-4 flex flex-col">
                    <h4 className="text-lg font-semibold text-[#3b6271]">Gerar com IA</h4>
                    <p className="text-sm text-gray-500">Cole um trecho do texto e a IA criará uma pergunta para você.</p>
                    <textarea
                        value={aiText}
                        onChange={e => setAiText(e.target.value)}
                        placeholder="Cole aqui o conteúdo para gerar uma pergunta..."
                        className="w-full flex-grow p-2 bg-white border border-gray-300 rounded-md focus:ring-2 focus:ring-[#1a5a73] focus:outline-none disabled:bg-gray-100"
                        disabled={isGenerating}
                        rows={5}
                    />
                    <button
                        onClick={handleGenerateWithAi}
                        disabled={isGenerating}
                        className="w-full flex items-center justify-center bg-[#0f3b4d] text-white font-bold py-3 px-4 rounded-lg hover:bg-[#1a5a73] transition-colors duration-300 disabled:bg-gray-400"
                    >
                        {isGenerating ? (
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                        ) : (
                            <>
                                <SparklesIcon className="w-5 h-5 mr-2" />
                                Gerar Pergunta
                            </>
                        )}
                    </button>
                </div>

                {/* Manual Addition/Editing */}
                <div className="space-y-4 flex flex-col">
                    <h4 className="text-lg font-semibold text-[#3b6271]">{editingId !== null ? 'Editar Pergunta' : 'Adicionar Manualmente'}</h4>
                    <p className="text-sm text-gray-500">{editingId !== null ? 'Ajuste a pergunta e a resposta abaixo.' : 'Insira sua própria pergunta e resposta.'}</p>
                    <input
                        type="text"
                        value={manualQuestion}
                        onChange={e => setManualQuestion(e.target.value)}
                        placeholder="Digite a pergunta"
                        className="w-full p-2 bg-white border border-gray-300 rounded-md focus:ring-2 focus:ring-[#1a5a73] focus:outline-none"
                    />
                    <textarea
                        value={manualAnswer}
                        onChange={e => setManualAnswer(e.target.value)}
                        placeholder="Digite a resposta"
                        className="w-full flex-grow p-2 bg-white border border-gray-300 rounded-md focus:ring-2 focus:ring-[#1a5a73] focus:outline-none"
                        rows={3}
                    />
                    <div className="flex items-center space-x-2">
                        {editingId !== null && (
                            <button onClick={handleCancelEdit} className="w-full bg-gray-200 text-gray-800 font-bold py-3 px-4 rounded-lg hover:bg-gray-300 transition-colors">Cancelar</button>
                        )}
                        <button onClick={handleSaveManual} className="w-full flex items-center justify-center bg-gray-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-gray-700 transition-colors duration-300">
                            {editingId !== null ? 'Salvar Alterações' : (<><PlusIcon className="w-5 h-5 mr-2" /> Adicionar</>)}
                        </button>
                    </div>
                </div>
            </div>

            <div className="mt-12">
                <h3 className="text-2xl font-bold text-[#0f3b4d] mb-4">Gerenciar Perguntas ({quiz.length})</h3>
                <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                    {quiz.map((q) => (
                        <div key={q.id} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg hover:bg-gray-100">
                            <p className="flex-1 text-sm text-gray-700 pr-4 truncate" title={q.question}>{q.question}</p>
                            <div className="flex-shrink-0 flex items-center space-x-2">
                                <button onClick={() => handleStartEdit(q.id)} className="p-1 text-gray-500 hover:text-blue-600 transition-colors" aria-label="Editar Pergunta">
                                    <EditIcon className="w-5 h-5" />
                                </button>
                                <button onClick={() => handleDelete(q.id)} className="p-1 text-gray-500 hover:text-red-600 transition-colors" aria-label="Apagar Pergunta">
                                    <TrashIcon className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};


const DashboardView: React.FC<{
    pdf: PdfRecord;
    onStartQuiz: () => void;
    onAddQuestion: (question: Omit<QuizQuestion, 'id'>) => void;
    onEditQuestion: (question: QuizQuestion) => void;
    onDeleteQuestion: (questionId: string) => void;
}> = ({ pdf, onStartQuiz, onAddQuestion, onEditQuestion, onDeleteQuestion }) => (
    <div className="w-full max-w-4xl mx-auto p-4 md:p-8 space-y-8">
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-8">
            <h2 className="text-3xl font-bold text-[#0f3b4d] mb-4">{pdf.displayName}</h2>
            <button onClick={onStartQuiz} className="bg-[#0f3b4d] text-white font-bold py-3 px-6 rounded-lg hover:bg-[#1a5a73] transition-colors duration-300">
                Iniciar Novo Quiz ({pdf.quiz.length} perguntas)
            </button>
        </div>

        <QuizEditor
            quiz={pdf.quiz}
            onAddQuestion={onAddQuestion}
            onEditQuestion={onEditQuestion}
            onDeleteQuestion={onDeleteQuestion}
        />

        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-8">
            <h3 className="text-2xl font-bold text-[#0f3b4d] mb-4">Histórico de Tentativas</h3>
            {pdf.quizAttempts.length > 0 ? (
                <ul className="space-y-3">
                    {pdf.quizAttempts.slice().reverse().map((attempt) => {
                        const correct = attempt.answers.filter(a => a === AnswerStatus.CORRECT).length;
                        const total = attempt.answers.length;
                        const score = total > 0 ? (correct / total) * 100 : 0;
                        return (
                            <li key={attempt.date} className="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
                                <span className="text-gray-600">{new Date(attempt.date).toLocaleString()}</span>
                                <span className="font-semibold text-[#3b6271]">{correct} / {total} ({score.toFixed(0)}%)</span>
                            </li>
                        );
                    })}
                </ul>
            ) : <p className="text-gray-500">Você ainda não completou nenhum quiz para este material.</p>}
        </div>
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-8">
            <h3 className="text-2xl font-bold text-[#0f3b4d] mb-4">Resumo do PDF</h3>
            <div className="prose max-w-none text-gray-700 whitespace-pre-wrap">{pdf.summary}</div>
        </div>
    </div>
);

const Sidebar: React.FC<{
    isOpen: boolean;
    records: PdfRecord[];
    activeId: string | null;
    onSelect: (id: string) => void;
    onRename: (id: string, newName: string) => void;
    onDelete: (id: string) => void;
}> = ({ isOpen, records, activeId, onSelect, onRename, onDelete }) => {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [name, setName] = useState('');

    const handleRename = (record: PdfRecord) => {
        setEditingId(record.id);
        setName(record.displayName);
    };

    const handleSaveRename = () => {
        if (editingId && name.trim()) {
            onRename(editingId, name.trim());
        }
        setEditingId(null);
    };

    return (
        <aside className={`fixed top-0 left-0 h-full bg-[#0f3b4d] text-white w-64 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'} z-20 flex flex-col`}>
            <h2 className="text-xl font-bold p-4 border-b border-white/20 flex-shrink-0">Meus Materiais</h2>
            <nav className="flex-grow overflow-y-auto">
                <ul>
                    {records.map(record => (
                        <li key={record.id} className={`border-b border-white/10 ${activeId === record.id ? 'bg-[#1a5a73]' : ''}`}>
                            <div className="flex items-center p-3">
                                {editingId === record.id ? (
                                    <>
                                        <input type="text" value={name} onChange={e => setName(e.target.value)} className="bg-transparent border-b w-full focus:outline-none" />
                                        <button onClick={handleSaveRename} className="p-1 ml-2 hover:text-green-300"><CheckIcon className="w-4 h-4" /></button>
                                    </>
                                ) : (
                                    <>
                                        <button onClick={() => onSelect(record.id)} className="flex-grow text-left truncate">{record.displayName}</button>
                                        <button onClick={() => handleRename(record)} className="p-1 ml-2 hover:text-yellow-300"><EditIcon className="w-4 h-4" /></button>
                                        <button onClick={() => onDelete(record.id)} className="p-1 ml-1 hover:text-red-300"><TrashIcon className="w-4 h-4" /></button>
                                    </>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            </nav>
        </aside>
    );
};


// --- Main App Component ---
type GameState = 'upload' | 'loading' | 'dashboard' | 'quiz' | 'results';

export default function App() {
    const [pdfRecords, setPdfRecords] = useLocalStorage<PdfRecord[]>('pdfQuizRecords', []);
    const [activePdfId, setActivePdfId] = useState<string | null>(null);
    const [isSidebarOpen, setSidebarOpen] = useState(true);
    const [gameState, setGameState] = useState<GameState>('upload');
    const [loadingMessage, setLoadingMessage] = useState('');
    const [currentQuiz, setCurrentQuiz] = useState<QuestionState[]>([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const activePdf = useMemo(() => pdfRecords.find(p => p.id === activePdfId), [pdfRecords, activePdfId]);

    useEffect(() => {
        if (pdfRecords.length > 0 && !activePdfId) {
            setActivePdfId(pdfRecords[0].id);
            setGameState('dashboard');
        } else if (pdfRecords.length === 0) {
            setGameState('upload');
            setActivePdfId(null);
        }
    }, [pdfRecords, activePdfId]);

    const handleAddNew = () => {
        setActivePdfId(null);
        setGameState('upload');
    };

    const handleFileUpload = useCallback(async (file: File) => {
        setGameState('loading');
        setLoadingMessage('Extraindo texto do PDF...');
        setError(null);
        try {
            const text = await extractTextFromPdf(file);
            setLoadingMessage('Gerando quiz e resumo com IA...');
            const data: GeminiQuizResponse = await generateQuizAndSummaryFromText(text);

            const newRecord: PdfRecord = {
                id: `pdf_${Date.now()}`,
                fileName: file.name,
                displayName: file.name.replace(/\.pdf$/i, ''),
                summary: data.summary,
                quiz: data.quiz.map((q) => ({ ...q, id: crypto.randomUUID() })),
                quizAttempts: [],
                createdAt: Date.now()
            };

            setPdfRecords(prevRecords => [newRecord, ...prevRecords]);
            setActivePdfId(newRecord.id);
            setGameState('dashboard');
        } catch (err: any) {
            setError(err.message || "Ocorreu um erro desconhecido.");
            setGameState('upload');
        }
    }, [setPdfRecords]);

    const handleSelectPdf = (id: string) => {
        setActivePdfId(id);
        setGameState('dashboard');
    };

    const handleRenamePdf = (id: string, newName: string) => {
        setPdfRecords(pdfRecords.map(p => p.id === id ? { ...p, displayName: newName } : p));
    };

    const handleDeletePdf = (id: string) => {
        if (window.confirm("Tem certeza que deseja apagar este material e todo o seu histórico?")) {
            const newRecords = pdfRecords.filter(p => p.id !== id);
            setPdfRecords(newRecords);
            if (activePdfId === id) {
                setActivePdfId(newRecords.length > 0 ? newRecords[0].id : null);
                setGameState(newRecords.length > 0 ? 'dashboard' : 'upload');
            }
        }
    };

    const handleStartQuiz = () => {
        if (!activePdf || activePdf.quiz.length === 0) {
            alert("Não há perguntas no quiz. Adicione algumas antes de começar.");
            return;
        };
        const newQuiz: QuestionState[] = activePdf.quiz.map(q => ({ ...q, isRevealed: false, status: AnswerStatus.UNANSWERED }));
        setCurrentQuiz(newQuiz);
        setCurrentQuestionIndex(0);
        setGameState('quiz');
    };

    const handleAddQuestionToPdf = (newQuestionData: Omit<QuizQuestion, 'id'>) => {
        if (!activePdfId) return;
        const newQuestionWithId: QuizQuestion = {
            ...newQuestionData,
            id: crypto.randomUUID(),
        };
        setPdfRecords(prevRecords =>
            prevRecords.map(record =>
                record.id === activePdfId
                    ? { ...record, quiz: [...record.quiz, newQuestionWithId] }
                    : record
            )
        );
    };

    const handleEditQuestionInPdf = (updatedQuestion: QuizQuestion) => {
        if (!activePdfId) return;
        setPdfRecords(prevRecords =>
            prevRecords.map(record =>
                record.id === activePdfId
                    ? { ...record, quiz: record.quiz.map(q => q.id === updatedQuestion.id ? updatedQuestion : q) }
                    : record
            )
        );
    };
    
    const handleDeleteQuestionFromPdf = (questionId: string) => {
        if (!activePdfId) return;
        setPdfRecords(prevRecords =>
            prevRecords.map(record =>
                record.id === activePdfId
                    ? { ...record, quiz: record.quiz.filter(q => q.id !== questionId) }
                    : record
            )
        );
    }

    const handleRevealAnswer = useCallback(() => {
        setCurrentQuiz(prev => prev.map((q, index) => index === currentQuestionIndex ? { ...q, isRevealed: true } : q));
    }, [currentQuestionIndex]);

    const handleAnswer = useCallback((status: AnswerStatus) => {
        setCurrentQuiz(prev => prev.map((q, index) => index === currentQuestionIndex ? { ...q, status } : q));
    }, [currentQuestionIndex]);

    const handleNextQuestion = useCallback(() => {
        if (currentQuestionIndex < currentQuiz.length - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
        } else {
            const newAttempt: QuizAttempt = {
                date: Date.now(),
                answers: currentQuiz.map(q => q.status),
            };
            setPdfRecords(prevRecords => prevRecords.map(p => p.id === activePdfId ? { ...p, quizAttempts: [...p.quizAttempts, newAttempt] } : p));
            setGameState('results');
        }
    }, [currentQuestionIndex, currentQuiz.length, currentQuiz, activePdfId, setPdfRecords]);

    const renderContent = () => {
        switch (gameState) {
            case 'loading': return <LoadingView message={loadingMessage} />;
            case 'dashboard': return activePdf && <DashboardView pdf={activePdf} onStartQuiz={handleStartQuiz} onAddQuestion={handleAddQuestionToPdf} onEditQuestion={handleEditQuestionInPdf} onDeleteQuestion={handleDeleteQuestionFromPdf} />;
            case 'quiz': return currentQuiz.length > 0 && <QuizCard questionState={currentQuiz[currentQuestionIndex]} current={currentQuestionIndex + 1} total={currentQuiz.length} onReveal={handleRevealAnswer} onAnswer={handleAnswer} onNext={handleNextQuestion} />;
            case 'results':
                const lastAttempt = activePdf?.quizAttempts[activePdf.quizAttempts.length - 1];
                return lastAttempt && <ResultsView attempt={lastAttempt} totalQuestions={activePdf?.quiz.length || 0} onBackToDashboard={() => setGameState('dashboard')} />;
            case 'upload': default: return <FileUpload onFileUpload={handleFileUpload} isLoading={gameState === 'loading'} hasRecords={pdfRecords.length > 0} />;
        }
    }

    return (
        <div className="min-h-screen flex font-sans text-slate-800">
            <Sidebar isOpen={isSidebarOpen} records={pdfRecords} activeId={activePdfId} onSelect={handleSelectPdf} onRename={handleRenamePdf} onDelete={handleDeletePdf} />
            <div className={`flex-grow flex flex-col transition-all duration-300 ease-in-out ${isSidebarOpen ? 'ml-64' : 'ml-0'}`}>
                <header className="flex-shrink-0">
                    <div className="container mx-auto px-4 py-3 flex justify-between items-center">
                        <button onClick={() => setSidebarOpen(!isSidebarOpen)} className="p-2 text-[#0f3b4d] hover:text-[#1a5a73]">
                            <MenuIcon className="w-6 h-6" />
                        </button>
                        <div className="w-32 h-2 bg-[#0f3b4d]/50 rounded-full"></div>
                        <button onClick={handleAddNew} className="p-2 text-[#0f3b4d] hover:text-[#1a5a73]">
                            <RefreshIcon className="w-6 h-6" />
                        </button>
                    </div>
                </header>
                <main className="flex-grow flex items-center justify-center p-4">
                    {error && (
                        <div className="absolute top-20 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg" role="alert">
                            <strong className="font-bold">Erro: </strong>
                            <span className="block sm:inline">{error}</span>
                        </div>
                    )}
                    {renderContent()}
                </main>
            </div>
        </div>
    );
}
