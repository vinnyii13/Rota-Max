import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, collection, query, onSnapshot, orderBy, addDoc } from 'firebase/firestore';
import { Loader2, Settings, Calendar, LineChart, TrendingUp, DollarSign, Bike, BatteryCharging, User, Camera } from 'lucide-react';

// --- Variáveis Globais (Fornecidas pelo index.html) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? initialAuthToken : null;

// Função auxiliar para formatar moeda
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount);
};

// Função auxiliar para obter o início da semana (Segunda-feira) para uma determinada data
const getStartOfWeek = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Ajuste para começar na Segunda (1)
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
};

// Função auxiliar para obter o início do mês
const getStartOfMonth = (date) => {
    const d = new Date(date);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
};

// Instâncias Globais do Firebase
let app = null;
let db = null;
let auth = null;

// URL da imagem de fallback para a foto da moto
const PLACEHOLDER_BIKE_URL = "https://placehold.co/150x150/1f2937/ffffff?text=Rota+Max";


// Componente Principal da Aplicação
const App = () => {
    const [currentTab, setCurrentTab] = useState('reports'); // Aba padrão
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [userId, setUserId] = useState(null);
    const [config, setConfig] = useState({
        username: '',
        bikeModel: '',
        oilChangeCost: 0,
        oilChangeIntervalKm: 0,
        dailyGoal: 0,
        workDaysPerWeek: 7,
        fuelType: 'gasoline', 
        bikePhotoUrl: '', // Armazena Base64 da foto
    });
    const [dailyLogs, setDailyLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // 1. Inicialização e Autenticação do Firebase
    useEffect(() => {
        if (Object.keys(firebaseConfig).length === 0) {
            console.error("Configuração do Firebase não encontrada.");
            setError("Erro: Configuração do Firebase não encontrada.");
            setLoading(false);
            return;
        }

        try {
            app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            auth = getAuth(app);

            // Listener de Autenticação
            const unsubscribe = onAuthStateChanged(auth, async (user) => {
                if (user) {
                    setUserId(user.uid);
                    setIsAuthReady(true);
                    console.log("Usuário autenticado:", user.uid);
                } else {
                    // Autentica anonimamente se não houver token disponível
                    try {
                        if (initialAuthToken) {
                            await signInWithCustomToken(auth, initialAuthToken);
                        } else {
                            await signInAnonymously(auth);
                        }
                    } catch (e) {
                        console.error("Erro na autenticação:", e);
                        setError("Erro ao autenticar o usuário.");
                    }
                }
                setLoading(false);
            });

            return () => unsubscribe();
        } catch (e) {
            console.error("Erro ao inicializar Firebase:", e);
            setError("Erro ao inicializar o serviço de dados.");
            setLoading(false);
        }
    }, []);

    // 2. Buscar/Escutar Dados de Configuração
    useEffect(() => {
        if (!isAuthReady || !userId || !db) return;

        const configDocRef = doc(db, 'artifacts', appId, 'users', userId, 'config', 'user_settings');

        const unsubscribe = onSnapshot(configDocRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setConfig({
                    username: data.username || '',
                    bikeModel: data.bikeModel || '',
                    oilChangeCost: parseFloat(data.oilChangeCost) || 0,
                    oilChangeIntervalKm: parseInt(data.oilChangeIntervalKm) || 0,
                    dailyGoal: parseFloat(data.dailyGoal) || 0,
                    workDaysPerWeek: parseInt(data.workDaysPerWeek) || 7,
                    fuelType: data.fuelType || 'gasoline', 
                    bikePhotoUrl: data.bikePhotoUrl || '', // Carregar Base64
                });
            }
        }, (e) => {
            console.error("Erro ao ler configuração:", e);
            setError("Erro ao carregar configurações.");
        });

        return () => unsubscribe();
    }, [isAuthReady, userId]);

    // 3. Buscar/Escutar Registros Diários
    useEffect(() => {
        if (!isAuthReady || !userId || !db) return;

        // Query: logs ordenados por data (mais recente primeiro)
        const logsCollectionRef = collection(db, 'artifacts', appId, 'users', userId, 'daily_logs');
        const q = query(logsCollectionRef, orderBy('date', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const logs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                date: doc.data().date instanceof Date ? doc.data().date.toISOString().split('T')[0] : doc.data().date, // Garantir que a data esteja no formato string 'YYYY-MM-DD'
                profit: parseFloat(doc.data().profit) || 0,
                gasolineCost: parseFloat(doc.data().gasolineCost) || 0,
                oilCost: parseFloat(doc.data().oilCost) || 0, // Custo rateado do óleo
            }));
            setDailyLogs(logs);
        }, (e) => {
            console.error("Erro ao ler logs diários:", e);
            setError("Erro ao carregar registros diários.");
        });

        return () => unsubscribe();
    }, [isAuthReady, userId]);

    // --- Manipuladores de Dados ---

    // Salvar Configuração
    const saveConfig = async (newConfig) => {
        if (!userId || !db) {
            setError("Dados não carregados. Tente novamente após a autenticação.");
            return;
        }
        setLoading(true);
        try {
            const configDocRef = doc(db, 'artifacts', appId, 'users', userId, 'config', 'user_settings');
            await setDoc(configDocRef, {
                username: newConfig.username,
                bikeModel: newConfig.bikeModel,
                oilChangeCost: parseFloat(newConfig.oilChangeCost) || 0,
                oilChangeIntervalKm: parseInt(newConfig.oilChangeIntervalKm) || 0,
                dailyGoal: parseFloat(newConfig.dailyGoal) || 0,
                workDaysPerWeek: parseInt(newConfig.workDaysPerWeek) || 7,
                fuelType: newConfig.fuelType, 
                bikePhotoUrl: newConfig.bikePhotoUrl, // Salvar Base64 ou URL fallback
            });
            setConfig(newConfig);
            console.log("Configuração salva com sucesso!");
        } catch (e) {
            console.error("Erro ao salvar configuração:", e);
            setError("Erro ao salvar a configuração. Verifique sua conexão.");
        } finally {
            setLoading(false);
        }
    };

    // Adicionar Registro Diário
    const addDailyLog = async (logData) => {
        if (!userId || !db) {
            setError("Dados não carregados. Tente novamente após a autenticação.");
            return false;
        }
        setLoading(true);
        try {
            const logsCollectionRef = collection(db, 'artifacts', appId, 'users', userId, 'daily_logs');
            await addDoc(logsCollectionRef, {
                ...logData,
                date: logData.date, // Armazenando como string 'YYYY-MM-DD'
                profit: parseFloat(logData.profit) || 0,
                gasolineCost: parseFloat(logData.gasolineCost) || 0,
                oilCost: parseFloat(logData.oilCost) || 0, 
            });
            console.log("Registro diário adicionado com sucesso!");
            return true;
        } catch (e) {
            console.error("Erro ao adicionar registro diário:", e);
            setError("Erro ao adicionar registro diário. Verifique sua conexão.");
            return false;
        } finally {
            setLoading(false);
        }
    };

    // --- Componentes de UI ---

    // Componente: Configuração
    const ConfigurationView = () => {
        const [formData, setFormData] = useState(config);
        const [fileMessage, setFileMessage] = useState('');

        useEffect(() => {
            setFormData(config);
        }, [config]);

        const handleChange = (e) => {
            const { name, value } = e.target;
            setFormData(prev => ({ ...prev, [name]: value }));
        };

        const handleFileChange = (event) => {
            setFileMessage('');
            const file = event.target.files[0];
            
            if (file) {
                // Verificar tamanho do arquivo (limite de 500KB)
                const MAX_SIZE = 500 * 1024;
                if (file.size > MAX_SIZE) { 
                    setFileMessage('ERRO: A imagem é muito grande. Use uma imagem menor que 500KB.');
                    event.target.value = null; // Limpar o input
                    return;
                }
        
                const reader = new FileReader();
                reader.onloadend = () => {
                    // Armazenar a string Base64 no campo bikePhotoUrl
                    setFormData(prev => ({ ...prev, bikePhotoUrl: reader.result }));
                    setFileMessage('Foto carregada com sucesso! Clique em Salvar Configurações.');
                };
                reader.onerror = () => {
                    setFileMessage('ERRO: Não foi possível ler o arquivo de imagem.');
                }
                reader.readAsDataURL(file);
            }
        };

        const handleSubmit = (e) => {
            e.preventDefault();
            saveConfig(formData);
        };

        return (
            <div className="p-4 bg-gray-800 shadow-2xl rounded-xl max-w-lg mx-auto border border-gray-700">
                {/* Título Centralizado */}
                <h2 className="text-3xl font-extrabold mb-6 text-indigo-400 flex items-center justify-center">
                    <Settings className="w-6 h-6 mr-2" />
                    Configurações
                </h2>
                <form onSubmit={handleSubmit} className="space-y-6">
                    
                    {/* User and Bike Info */}
                    <div className="p-4 bg-gray-700 rounded-lg shadow-inner">
                        <h3 className="font-semibold text-indigo-300 mb-4 flex items-center border-b border-indigo-500/50 pb-2">
                            <User className="w-4 h-4 mr-2"/> Dados Pessoais & Moto
                        </h3>
                        
                        {/* Bike Photo Display and Input */}
                        <div className="flex flex-col items-center mb-6">
                            <img 
                                src={formData.bikePhotoUrl || PLACEHOLDER_BIKE_URL} 
                                alt="Foto da Moto"
                                className="w-32 h-32 object-cover rounded-full border-4 border-indigo-500 shadow-xl mb-3"
                                // Lidar com erro para URL e Base64 (se corrompido)
                                onError={(e) => { e.target.onerror = null; e.target.src=PLACEHOLDER_BIKE_URL; }} 
                            />
                            <label className="block text-sm font-medium text-gray-400 mt-2 flex items-center w-full">
                                <Camera className="w-4 h-4 mr-1"/> Enviar Foto da Moto (Galeria/Arquivo)
                            </label>
                            <input 
                                type="file" 
                                name="bikePhotoUrl" 
                                accept="image/png, image/jpeg"
                                onChange={handleFileChange}
                                className="mt-1 block w-full text-sm text-gray-400 
                                file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 
                                file:text-sm file:font-semibold file:bg-indigo-600 file:text-white 
                                hover:file:bg-indigo-500 file:cursor-pointer bg-gray-900 rounded-lg p-1"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                A foto será armazenada em Base64. Máx. 500KB.
                            </p>
                            {fileMessage && (
                                <p className={`mt-2 text-sm font-semibold ${fileMessage.includes('ERRO') ? 'text-red-400' : 'text-green-400'}`}>
                                    {fileMessage}
                                </p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-400">Nome de Usuário</label>
                            <input type="text" name="username" value={formData.username} onChange={handleChange}
                                className="mt-1 block w-full rounded-md border-gray-600 bg-gray-900 text-white shadow-sm p-2 focus:border-indigo-500 focus:ring-indigo-500"
                                placeholder="Seu nome ou apelido" required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mt-3">Modelo da Moto</label>
                            <input type="text" name="bikeModel" value={formData.bikeModel} onChange={handleChange}
                                className="mt-1 block w-full rounded-md border-gray-600 bg-gray-900 text-white shadow-sm p-2 focus:border-indigo-500 focus:ring-indigo-500"
                                placeholder="Ex: Honda CG 160" required
                            />
                        </div>
                    </div>

                    {/* Maintenance and Goals */}
                    <div className="p-4 bg-gray-700 rounded-lg shadow-inner">
                        <h3 className="font-semibold text-green-300 mb-4 flex items-center border-b border-green-500/50 pb-2">
                            <Bike className="w-4 h-4 mr-2"/> Dados de Custos e Metas
                        </h3>
                        
                        {/* Tipo de Combustível */}
                        <div>
                            <label className="block text-sm font-medium text-gray-400">Combustível Utilizado</label>
                            <select name="fuelType" value={formData.fuelType} onChange={handleChange}
                                className="mt-1 block w-full rounded-md border-gray-600 bg-gray-900 text-white shadow-sm p-2 focus:border-indigo-500 focus:ring-indigo-500"
                            >
                                <option value="gasoline">Gasolina</option>
                                <option value="alcohol">Álcool</option>
                            </select>
                            <p className="text-xs text-gray-500 mt-1">Define o rótulo de gasto nos relatórios.</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-400 mt-3">Custo da Troca de Óleo (R$)</label>
                            <input type="number" name="oilChangeCost" value={formData.oilChangeCost} onChange={handleChange}
                                className="mt-1 block w-full rounded-md border-gray-600 bg-gray-900 text-white shadow-sm p-2 focus:border-indigo-500 focus:ring-indigo-500"
                                step="0.01" min="0" placeholder="Ex: 80.00"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mt-3">Troca de Óleo (Intervalo em Km)</label>
                            <input type="number" name="oilChangeIntervalKm" value={formData.oilChangeIntervalKm} onChange={handleChange}
                                className="mt-1 block w-full rounded-md border-gray-600 bg-gray-900 text-white shadow-sm p-2 focus:border-indigo-500 focus:ring-indigo-500"
                                min="1" placeholder="Ex: 1000"
                            />
                        </div>
                        
                        {/* Dias de Trabalho por Semana */}
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mt-3">Dias de Trabalho por Semana (Para rateio do óleo)</label>
                            <select name="workDaysPerWeek" value={formData.workDaysPerWeek} onChange={handleChange}
                                className="mt-1 block w-full rounded-md border-gray-600 bg-gray-900 text-white shadow-sm p-2 focus:border-indigo-500 focus:ring-indigo-500"
                            >
                                <option value="5">5 Dias (Segunda a Sexta)</option>
                                <option value="6">6 Dias</option>
                                <option value="7">7 Dias (Todos os dias)</option>
                            </select>
                        </div>
                        
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mt-3">Meta Diária de Lucro Líquido (R$)</label>
                            <input type="number" name="dailyGoal" value={formData.dailyGoal} onChange={handleChange}
                                className="mt-1 block w-full rounded-md border-gray-600 bg-gray-900 text-white shadow-sm p-2 focus:border-indigo-500 focus:ring-indigo-500"
                                step="0.01" min="0" placeholder="Ex: 150.00"
                            />
                        </div>
                    </div>

                    <button type="submit"
                        className="w-full py-3 px-4 border border-transparent rounded-lg shadow-lg text-lg font-bold text-white bg-indigo-600 hover:bg-indigo-500 transition duration-150 ease-in-out transform hover:scale-[1.01] focus:outline-none focus:ring-4 focus:ring-indigo-600/50"
                        disabled={loading}
                    >
                        {loading ? 'Salvando...' : 'Salvar Configurações'}
                    </button>
                </form>
                {config.username && <p className="mt-4 text-center text-sm text-gray-400">Configuração de **{config.username}** salva.</p>}
            </div>
        );
    };

    // Componente: Registro Diário
    const DailyLogView = () => {
        const today = new Date().toISOString().split('T')[0];
        const [date, setDate] = useState(today);
        const [profit, setProfit] = useState('');
        const [gasolineCost, setGasolineCost] = useState('');
        const [message, setMessage] = useState('');

        // Calcula o custo diário do óleo rateado
        const dailyOilCost = useMemo(() => {
            const cost = parseFloat(config.oilChangeCost);
            const days = parseInt(config.workDaysPerWeek);
            if (cost > 0 && days > 0) {
                // Rateia o custo total do óleo pelo número de dias de trabalho na semana
                return cost / days;
            }
            return 0;
        }, [config.oilChangeCost, config.workDaysPerWeek]);

        const handleSubmit = async (e) => {
            e.preventDefault();
            setMessage('');
            const success = await addDailyLog({
                date,
                profit: profit,
                gasolineCost: gasolineCost,
                oilCost: dailyOilCost, // Adicionar custo diário do óleo rateado
            });

            if (success) {
                setMessage('Registro salvo com sucesso!');
                setProfit('');
                setGasolineCost('');
            } else {
                setMessage('Falha ao salvar o registro. Tente novamente.');
            }
        };

        return (
            <div className="p-4 bg-gray-800 shadow-2xl rounded-xl max-w-lg mx-auto border border-gray-700">
                {/* Título Centralizado */}
                <h2 className="text-3xl font-extrabold mb-6 text-indigo-400 flex items-center justify-center">
                    <Calendar className="w-6 h-6 mr-2" />
                    Registro Diário
                </h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-400">Data do Registro</label>
                        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-600 bg-gray-900 text-white shadow-sm p-2 focus:border-green-500 focus:ring-green-500"
                            required
                        />
                    </div>
                    {/* Campo Rendimento Bruto */}
                    <div>
                        <label className="block text-sm font-medium text-gray-400 flex items-center">
                            <TrendingUp className="w-4 h-4 mr-1 text-green-500"/> Rendimento Bruto do Dia (R$)
                        </label>
                        <input type="number" value={profit} onChange={(e) => setProfit(e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-600 bg-gray-900 text-white shadow-sm p-2 focus:border-green-500 focus:ring-green-500"
                            step="0.01" min="0" placeholder="Ex: 185.50" required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-400 flex items-center">
                            <BatteryCharging className="w-4 h-4 mr-1 text-red-500"/> Gasto com {config.fuelType === 'alcohol' ? 'Álcool' : 'Gasolina'} (R$)
                        </label>
                        <input type="number" value={gasolineCost} onChange={(e) => setGasolineCost(e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-600 bg-gray-900 text-white shadow-sm p-2 focus:border-red-500 focus:ring-red-500"
                            step="0.01" min="0" placeholder="Ex: 35.00" required
                        />
                    </div>
                    
                    {/* Custo Diário do Óleo Rateado */}
                    {config.oilChangeCost > 0 && config.workDaysPerWeek > 0 && (
                        <div className="p-3 bg-gray-700 rounded-md mt-4 border border-indigo-500/50">
                            <label className="block text-sm font-medium text-gray-400 flex items-center">
                                <DollarSign className="w-4 h-4 mr-1 text-indigo-400"/> Custo Diário do Óleo (Rateado)
                            </label>
                            <p className="mt-1 text-xl font-extrabold text-indigo-400">
                                {formatCurrency(dailyOilCost)}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                                Baseado em {formatCurrency(config.oilChangeCost)} / {config.workDaysPerWeek} dias.
                            </p>
                        </div>
                    )}

                    <button type="submit"
                        className="w-full py-3 px-4 border border-transparent rounded-lg shadow-lg text-lg font-bold text-white bg-green-600 hover:bg-green-500 transition duration-150 ease-in-out transform hover:scale-[1.01] focus:outline-none focus:ring-4 focus:ring-green-600/50"
                        disabled={loading}
                    >
                        {loading ? 'Salvando...' : 'Registrar Dia'}
                    </button>
                    {message && <p className={`mt-3 text-center text-sm font-semibold ${message.includes('sucesso') ? 'text-green-400' : 'text-red-400'}`}>{message}</p>}
                </form>
            </div>
        );
    };

    // Componente: Relatórios (Cálculos e Visualização)
    const ReportsView = () => {
        // Usa useMemo para cálculos eficientes quando dailyLogs muda
        const { weeklySummary, monthlySummary } = useMemo(() => {
            const today = new Date();
            const startOfWeek = getStartOfWeek(today);
            const startOfMonth = getStartOfMonth(today);

            let weekProfit = 0;
            let weekGas = 0;
            let weekOil = 0; 
            let monthProfit = 0;
            let monthGas = 0;
            let monthOil = 0; 
            let daysLogged = new Set();
            let daysMetGoal = 0;

            dailyLogs.forEach(log => {
                // O lucro líquido agora considera o custo rateado do óleo
                const netProfit = log.profit - log.gasolineCost - log.oilCost;

                // Cálculos gerais
                if (!daysLogged.has(log.date)) {
                    // Verifica se a meta diária foi atingida (apenas uma vez por dia)
                    if (config.dailyGoal > 0 && netProfit >= config.dailyGoal) {
                        daysMetGoal++;
                    }
                    daysLogged.add(log.date);
                }

                const logDate = new Date(log.date);
                // Cálculo Semanal
                if (logDate >= startOfWeek) {
                    weekProfit += log.profit;
                    weekGas += log.gasolineCost;
                    weekOil += log.oilCost; // Incluir custo rateado do óleo
                }

                // Cálculo Mensal
                if (logDate >= startOfMonth) {
                    monthProfit += log.profit;
                    monthGas += log.gasolineCost;
                    monthOil += log.oilCost; // Incluir custo rateado do óleo
                }
            });

            return {
                weeklySummary: {
                    totalProfit: weekProfit,
                    totalGas: weekGas,
                    totalOil: weekOil, // Incluir no resumo
                    netProfit: weekProfit - weekGas - weekOil, // Ajustar cálculo
                },
                monthlySummary: {
                    totalProfit: monthProfit,
                    totalGas: monthGas,
                    totalOil: monthOil, // Incluir no resumo
                    netProfit: monthProfit - monthGas - monthOil, // Ajustar cálculo
                    daysLogged: daysLogged.size,
                    daysMetGoal: daysMetGoal,
                }
            };
        }, [dailyLogs, config.dailyGoal]);

        const ReportCard = ({ title, profit, gas, oil, net, period }) => (
            <div className="bg-gray-800 p-6 rounded-xl shadow-2xl transition duration-300 border-t-4 border-indigo-500 hover:border-t-indigo-400">
                <h3 className="text-xl font-semibold text-gray-100 mb-4">{title}</h3>
                <div className="space-y-3">
                    <div className="flex justify-between text-lg">
                        <span className="flex items-center text-green-400"><TrendingUp className="w-5 h-5 mr-2"/> Rendimento Bruto Total:</span>
                        <span className="font-bold text-gray-100">{formatCurrency(profit)}</span>
                    </div>
                    <div className="flex justify-between text-lg">
                        <span className="flex items-center text-red-400"><BatteryCharging className="w-5 h-5 mr-2"/> Gastos ({config.fuelType === 'alcohol' ? 'Álcool' : 'Gasolina'}):</span>
                        <span className="font-bold text-gray-100">{formatCurrency(gas)}</span>
                    </div>
                    {oil > 0 && ( // Exibir o custo rateado do óleo
                         <div className="flex justify-between text-lg">
                            <span className="flex items-center text-red-400"><DollarSign className="w-5 h-5 mr-2"/> Custo de Óleo (Rateado):</span>
                            <span className="font-bold text-gray-100">{formatCurrency(oil)}</span>
                        </div>
                    )}
                    <div className="pt-4 border-t border-gray-700 mt-4">
                        <div className="flex justify-between text-2xl">
                            <span className="font-extrabold text-indigo-400">Lucro Líquido:</span>
                            <span className={`font-extrabold ${net >= 0 ? 'text-green-400' : 'text-red-500'}`}>{formatCurrency(net)}</span>
                        </div>
                    </div>
                </div>
                {/* Monthly specific stats */}
                {period === 'monthly' && (
                    <div className="mt-4 pt-4 border-t border-gray-700 border-dashed text-sm text-gray-400">
                        <p>Dias Registrados: <span className="font-bold text-gray-200">{monthlySummary.daysLogged}</span></p>
                        {config.dailyGoal > 0 && (
                            <p>Meta Diária ({formatCurrency(config.dailyGoal)}) Atingida: <span className={`font-bold ${monthlySummary.daysMetGoal > 0 ? 'text-indigo-400' : 'text-gray-400'}`}>{monthlySummary.daysMetGoal} dias</span></p>
                        )}
                        <p>Custo do Óleo (R${config.oilChangeCost}): Rateado por {config.workDaysPerWeek} dias.</p>
                        <p>Combustível: <span className="font-bold text-gray-200">{config.fuelType === 'alcohol' ? 'Álcool' : 'Gasolina'}</span></p>
                    </div>
                )}
            </div>
        );


        if (dailyLogs.length === 0) {
            return (
                <div className="p-8 text-center bg-gray-700 rounded-xl max-w-2xl mx-auto border border-gray-600 shadow-xl">
                    <p className="text-2xl font-bold text-yellow-400">Nenhum registro encontrado!</p>
                    <p className="text-gray-400 mt-3">Vá para a aba "Registro Diário" para começar a adicionar seus rendimentos e gastos e ver seus relatórios aqui.</p>
                </div>
            );
        }

        return (
            <div className="p-4 max-w-4xl mx-auto space-y-8">
                {/* Título Centralizado */}
                <h2 className="text-3xl font-extrabold text-gray-100 mb-6 flex items-center justify-center">
                    <LineChart className="w-6 h-6 mr-3 text-indigo-400" />
                    Resumo de Lucros e Gastos
                </h2>

                <ReportCard
                    title="Resumo Semanal (Últimos 7 dias)"
                    profit={weeklySummary.totalProfit}
                    gas={weeklySummary.totalGas}
                    oil={weeklySummary.totalOil} 
                    net={weeklySummary.netProfit}
                    period="weekly"
                />

                <ReportCard
                    title="Resumo Mensal (Do Início do Mês até Hoje)"
                    profit={monthlySummary.totalProfit}
                    gas={monthlySummary.totalGas}
                    oil={monthlySummary.totalOil} 
                    net={monthlySummary.netProfit}
                    period="monthly"
                />

                {/* Last 5 Logs */}
                <div className="mt-8 bg-gray-700 p-6 rounded-xl shadow-inner border border-gray-600">
                    <h3 className="text-xl font-semibold text-gray-100 mb-4">Últimos Registros</h3>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-600">
                            <thead className="bg-gray-600">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Data</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Rendimento (R$)</th> 
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Gasto {config.fuelType === 'alcohol' ? 'Álcool' : 'Gasolina'} (R$)</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Óleo (R$)</th> 
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Líquido (R$)</th>
                                </tr>
                            </thead>
                            <tbody className="bg-gray-800 divide-y divide-gray-700">
                                {dailyLogs.slice(0, 5).map((log, index) => {
                                    const net = log.profit - log.gasolineCost - log.oilCost; 
                                    return (
                                        <tr key={index} className="hover:bg-gray-700 transition duration-150">
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-300">{log.date}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-green-400">{formatCurrency(log.profit)}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-red-400">{formatCurrency(log.gasolineCost)}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-red-400">{formatCurrency(log.oilCost)}</td> 
                                            <td className={`px-6 py-4 whitespace-nowrap text-sm font-semibold ${net >= 0 ? 'text-indigo-400' : 'text-red-500'}`}>{formatCurrency(net)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    };

    // --- Renderização Principal ---

    const NavButton = ({ tab, icon: Icon, label }) => (
        <button
            onClick={() => setCurrentTab(tab)}
            className={`flex flex-col items-center justify-center p-3 sm:px-4 sm:py-2 transition-all duration-200 rounded-lg focus:outline-none 
                ${currentTab === tab ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:bg-gray-700 hover:text-indigo-400'}`}
        >
            <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
            <span className="text-xs sm:text-sm mt-1 font-medium hidden sm:block">{label}</span>
            <span className="text-xs sm:text-sm mt-1 font-medium sm:hidden">{label.split(' ')[0]}</span>
        </button>
    );

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4">
                <div className="text-center p-8 bg-red-800 border border-red-400 text-white rounded-lg shadow-2xl">
                    <p className="font-bold text-xl mb-4">Ocorreu um Erro!</p>
                    <p>{error}</p>
                    <p className="mt-2 text-sm text-red-200">Tente recarregar a página ou verifique a conexão com a internet.</p>
                </div>
            </div>
        );
    }

    if (loading && !isAuthReady) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-gray-900">
                <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
                <p className="mt-4 text-gray-400 font-medium">Carregando dados...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-900 font-sans antialiased flex flex-col">
            {/* Cabeçalho e Navegação (TOPO CENTRALIZADO) */}
            <div className="bg-gray-800 shadow-xl w-full sticky top-0 z-10 p-4 border-b border-gray-700">
                {/* justify-center para centralizar no topo */}
                <header className="flex flex-col items-center justify-center max-w-4xl mx-auto">
                    <div className="flex flex-col items-center">
                        {/* A imagem pode ser URL ou Base64, o navegador trata data:image */}
                        {config.bikePhotoUrl && (
                            <img 
                                src={config.bikePhotoUrl} 
                                alt="Sua Moto" 
                                className="w-10 h-10 object-cover rounded-full border-2 border-indigo-500 mb-2 hidden sm:block"
                                onError={(e) => { e.target.onerror = null; e.target.style.display='none'; }}
                            />
                        )}
                        <div className="text-center">
                            <h1 className="text-2xl font-extrabold text-indigo-400">🏍️ Rota Max</h1>
                            <p className="text-xs text-gray-500 mt-1">Olá, {config.username || 'Usuário'}! ID: {userId}</p>
                        </div>
                    </div>
                </header>
            </div>
            
            <div className="flex-grow p-4 sm:p-8">
                {currentTab === 'config' && <ConfigurationView />}
                {currentTab === 'daily' && <DailyLogView />}
                {currentTab === 'reports' && <ReportsView />}
            </div>

            {/* Navegação Inferior (Fixa na parte inferior para mobile) */}
            <nav className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 shadow-2xl z-20">
                <div className="max-w-xl mx-auto flex justify-around">
                    <NavButton tab="reports" icon={LineChart} label="Relatórios" />
                    <NavButton tab="daily" icon={Calendar} label="Registro Diário" />
                    <NavButton tab="config" icon={Settings} label="Configurações" />
                </div>
            </nav>
            {/* Espaçador para navegação inferior em telas pequenas */}
            <div className="h-16 sm:h-0"></div>
        </div>
    );
};

export default App;