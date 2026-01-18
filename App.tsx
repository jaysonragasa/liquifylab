import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ToolType, BrushSettings, Layer } from './types';
import { LiquifyCanvas } from './components/LiquifyCanvas';
import { ToolsPanel } from './components/ToolsPanel';
import { generateSampleImage } from './services/geminiService';
import { Download, Upload, Wand2, Menu, X, Undo2, Redo2 } from 'lucide-react';

// History Snapshot Interface
interface HistoryStep {
  layers: Layer[];
  activeLayerId: string;
}

const HISTORY_MAX_STEPS = 20;
// Max dimension for mobile performance optimization (approx 4MP vs 20MP)
const MAX_IMAGE_DIMENSION = 2048;

const App: React.FC = () => {
  const [activeTool, setActiveTool] = useState<ToolType>(ToolType.WARP);
  const [brushSettings, setBrushSettings] = useState<BrushSettings>({
    size: 150,
    strength: 0.5,
    density: 0.5
  });
  
  // App State
  const [layers, setLayers] = useState<Layer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string>('');
  
  // History State
  const [history, setHistory] = useState<HistoryStep[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [prompt, setPrompt] = useState("A futuristic cyberpunk portrait, neon lights, highly detailed");
  const [showGenModal, setShowGenModal] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- History Management ---

  // Helper to deep clone layers (ImageData needs specific handling)
  const cloneLayers = (layersToClone: Layer[]): Layer[] => {
    return layersToClone.map(layer => ({
      ...layer,
      imageData: layer.imageData ? new ImageData(
        new Uint8ClampedArray(layer.imageData.data),
        layer.imageData.width,
        layer.imageData.height
      ) : null
    }));
  };

  const saveHistory = useCallback(() => {
    setHistory(prev => {
      // 1. Slice history to current index (remove redos if we start a new branch)
      const currentHistory = prev.slice(0, historyIndex + 1);
      
      // 2. Create snapshot
      const snapshot: HistoryStep = {
        layers: cloneLayers(layers),
        activeLayerId: activeLayerId
      };

      // 3. Push and limit size
      const newHistory = [...currentHistory, snapshot];
      if (newHistory.length > HISTORY_MAX_STEPS) {
        newHistory.shift();
      }
      return newHistory;
    });

    setHistoryIndex(prev => {
        const newLength = Math.min(prev + 1 + 1, HISTORY_MAX_STEPS); // +1 for slice logic, +1 for new item
        // Actually simpler: if we shifted, index stays at max-1. If not, it increments.
        // Let's just calculate based on new array length
        return (prev < HISTORY_MAX_STEPS - 1) ? prev + 1 : HISTORY_MAX_STEPS - 1;
    });
  }, [layers, activeLayerId, historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex >= 0) {
      const step = history[historyIndex];
      setLayers(cloneLayers(step.layers));
      setActiveLayerId(step.activeLayerId);
      setHistoryIndex(prev => prev - 1);
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      const step = history[nextIndex];
      // Note: Logic placeholder, see redoAction implementation below
    }
  }, [history, historyIndex]);

  // Revised Save Logic based on standard pattern
  const commitToHistory = useCallback((newLayers: Layer[], newActiveId: string) => {
      setHistory(prev => {
          const currentHist = prev.slice(0, historyIndex + 1);
          const snapshot: HistoryStep = {
              layers: cloneLayers(newLayers),
              activeLayerId: newActiveId
          };
          const newHist = [...currentHist, snapshot];
          if (newHist.length > HISTORY_MAX_STEPS) newHist.shift();
          return newHist;
      });
      setHistoryIndex(prev => {
          const next = prev + 1;
          return next >= HISTORY_MAX_STEPS ? HISTORY_MAX_STEPS - 1 : next;
      });
  }, [historyIndex]);

  const undoAction = () => {
      if (historyIndex > 0) { // If index is 0, that's initial state, can't undo further
          const prevIndex = historyIndex - 1;
          const step = history[prevIndex];
          setLayers(cloneLayers(step.layers));
          setActiveLayerId(step.activeLayerId);
          setHistoryIndex(prevIndex);
      }
  };

  const redoAction = () => {
      if (historyIndex < history.length - 1) {
          const nextIndex = historyIndex + 1;
          const step = history[nextIndex];
          setLayers(cloneLayers(step.layers));
          setActiveLayerId(step.activeLayerId);
          setHistoryIndex(nextIndex);
      }
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
            e.preventDefault();
            if (e.shiftKey) {
                redoAction();
            } else {
                undoAction();
            }
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
            e.preventDefault();
            redoAction();
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history]); // Deps are needed to access current state in closure

  // Initialize history with empty state
  useEffect(() => {
      if (history.length === 0) {
          const initial: HistoryStep = { layers: [], activeLayerId: '' };
          setHistory([initial]);
          setHistoryIndex(0);
      }
  }, []);

  // Handlers for Tools Panel
  // We need to commit history when adding/deleting layers
  const addImageLayer = (src: string, name: string = 'Layer') => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    img.onload = () => {
       // --- Optimization: Downscale Logic ---
       let width = img.width;
       let height = img.height;

       if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
           const ratio = width / height;
           if (width > height) {
               width = MAX_IMAGE_DIMENSION;
               height = Math.round(width / ratio);
           } else {
               height = MAX_IMAGE_DIMENSION;
               width = Math.round(height * ratio);
           }
       }

       const canvas = document.createElement('canvas');
       canvas.width = width;
       canvas.height = height;
       const ctx = canvas.getContext('2d');
       
       if (ctx) {
           // Use high quality scaling
           ctx.imageSmoothingEnabled = true;
           ctx.imageSmoothingQuality = 'high';
           ctx.drawImage(img, 0, 0, width, height);
           
           const imageData = ctx.getImageData(0, 0, width, height);
           
           if (imageData) {
               const newLayer: Layer = {
                   id: Date.now().toString(),
                   name: `${name} ${layers.length + 1}`,
                   visible: true,
                   imageData: imageData,
                   blendMode: 'source-over',
                   opacity: 1,
                   x: 0,
                   y: 0,
                   scale: 1,
                   rotation: 0
               };
               const newLayers = [...layers, newLayer];
               setLayers(newLayers);
               setActiveLayerId(newLayer.id);
               commitToHistory(newLayers, newLayer.id);
           }
       }
    };
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          addImageLayer(event.target.result as string, 'Image');
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerate = async () => {
    try {
      setIsGenerating(true);
      const result = await generateSampleImage(prompt);
      addImageLayer(result.imageUrl, 'GenAI');
      setShowGenModal(false);
    } catch (error) {
      console.error("Failed to generate image", error);
      alert("Failed to generate image. Ensure API Key is set.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      const link = document.createElement('a');
      link.download = 'liquified-image.png';
      link.href = canvas.toDataURL();
      link.click();
    }
  };

  // Layer Operations
  const toggleLayerVisibility = (id: string) => {
      const newLayers = layers.map(l => l.id === id ? { ...l, visible: !l.visible } : l);
      setLayers(newLayers);
      commitToHistory(newLayers, activeLayerId);
  };
  
  const deleteLayer = (id: string) => {
      let newActiveId = activeLayerId;
      const newLayers = layers.filter(l => l.id !== id);
      
      if (activeLayerId === id && newLayers.length > 0) {
          newActiveId = newLayers[newLayers.length - 1].id;
      } else if (newLayers.length === 0) {
          newActiveId = '';
      }
      
      setLayers(newLayers);
      setActiveLayerId(newActiveId);
      commitToHistory(newLayers, newActiveId);
  };

  const moveLayer = (id: string, dir: 'up' | 'down') => {
      const idx = layers.findIndex(l => l.id === id);
      if (idx === -1) return;
      const newLayers = [...layers];
      const swapIdx = dir === 'up' ? idx + 1 : idx - 1; 
      if (swapIdx >= 0 && swapIdx < newLayers.length) {
          [newLayers[idx], newLayers[swapIdx]] = [newLayers[swapIdx], newLayers[idx]];
          setLayers(newLayers);
          commitToHistory(newLayers, activeLayerId);
      }
  };

  const duplicateActiveLayer = () => {
      const active = layers.find(l => l.id === activeLayerId);
      if (active && active.imageData) {
          const newLayer: Layer = {
              ...active,
              id: Date.now().toString(),
              name: active.name + ' Copy',
              imageData: new ImageData(
                  new Uint8ClampedArray(active.imageData.data),
                  active.imageData.width,
                  active.imageData.height
              )
          };
          const newLayers = [...layers, newLayer];
          setLayers(newLayers);
          setActiveLayerId(newLayer.id);
          commitToHistory(newLayers, newLayer.id);
      }
  };

  // Pass this to ToolsPanel for properties that change rapidly (opacity/blend mode)
  // We commit only when the user finishes interaction (onMouseUp) or we accept granular history.
  // For simplicity, let's commit on every change for Select (Blend Mode) and granular for slider?
  // Actually, standard is change triggers history.
  const updateLayerProperty = (id: string, updates: Partial<Layer>) => {
      const newLayers = layers.map(l => l.id === id ? { ...l, ...updates } : l);
      setLayers(newLayers);
      commitToHistory(newLayers, activeLayerId);
  };

  // Dedicated function for LiquifyCanvas to call when a stroke/transform ends
  const onCanvasInteractionEnd = (updatedLayers: Layer[]) => {
      setLayers(updatedLayers);
      commitToHistory(updatedLayers, activeLayerId);
  };
  
  const updateLayerStateOnly = (id: string, updates: Partial<Layer>) => {
      setLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-900 text-white font-sans overflow-hidden">
      {/* Header */}
      <header className="h-16 border-b border-gray-750 bg-gray-850 flex items-center justify-between px-4 shrink-0 z-20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-accent-500 to-purple-600 rounded-lg flex items-center justify-center">
            <span className="font-bold text-lg">L</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight hidden sm:block">Liquify<span className="text-accent-500">Lab</span></h1>
        </div>
        
        {/* Undo/Redo Controls */}
        <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1 border border-gray-700">
            <button 
                onClick={undoAction} 
                disabled={historyIndex <= 0}
                className={`p-2 rounded hover:bg-gray-700 ${historyIndex <= 0 ? 'text-gray-600' : 'text-gray-200'}`}
                title="Undo (Ctrl+Z)"
            >
                <Undo2 className="w-4 h-4" />
            </button>
            <button 
                onClick={redoAction} 
                disabled={historyIndex >= history.length - 1}
                className={`p-2 rounded hover:bg-gray-700 ${historyIndex >= history.length - 1 ? 'text-gray-600' : 'text-gray-200'}`}
                title="Redo (Ctrl+Y)"
            >
                <Redo2 className="w-4 h-4" />
            </button>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowGenModal(true)}
            className="flex items-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-xs sm:text-sm font-medium transition-colors"
          >
            <Wand2 className="w-4 h-4" />
            <span className="hidden sm:inline">AI Gen</span>
          </button>

          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs sm:text-sm font-medium transition-colors"
          >
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Upload</span>
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept="image/*" 
            className="hidden" 
          />

          <button 
            onClick={handleDownload}
            disabled={layers.length === 0}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
              layers.length > 0
              ? 'bg-accent-600 hover:bg-accent-500 text-white' 
              : 'bg-gray-800 text-gray-500 cursor-not-allowed'
            }`}
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
          
          {/* Mobile Menu Toggle */}
          <button 
            className="sm:hidden p-2 text-gray-300"
            onClick={() => setShowMobileMenu(!showMobileMenu)}
          >
            {showMobileMenu ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative">
        <LiquifyCanvas 
          layers={layers}
          activeLayerId={activeLayerId}
          onInteractionEnd={onCanvasInteractionEnd}
          onUpdateLayerPreview={updateLayerStateOnly}
          tool={activeTool}
          brushSettings={brushSettings}
          isProcessing={isGenerating}
          zoomLevel={zoomLevel}
          setZoomLevel={setZoomLevel}
        />
        
        {/* Sidebar */}
        <div className={`
          absolute inset-y-0 right-0 z-10 transform transition-transform duration-300 ease-in-out
          sm:relative sm:translate-x-0 w-80 bg-gray-850 shadow-xl sm:shadow-none
          ${showMobileMenu ? 'translate-x-0' : 'translate-x-full'}
        `}>
          <ToolsPanel 
            activeTool={activeTool}
            setTool={setActiveTool}
            brushSettings={brushSettings}
            setBrushSettings={setBrushSettings}
            canUndo={historyIndex > 0}
            layers={layers}
            activeLayerId={activeLayerId}
            setActiveLayerId={(id) => { setActiveLayerId(id); /* Selecting doesn't create history */ }}
            toggleLayerVisibility={toggleLayerVisibility}
            deleteLayer={deleteLayer}
            moveLayer={moveLayer}
            addLayer={duplicateActiveLayer}
            zoomLevel={zoomLevel}
            setZoomLevel={setZoomLevel}
            updateLayer={updateLayerProperty}
          />
        </div>
      </div>

      {/* Generation Modal */}
      {showGenModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-850 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-purple-400" />
                Generate Sample
              </h3>
              <button 
                onClick={() => setShowGenModal(false)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            
            <p className="text-gray-400 text-sm mb-4">
              Create a starting image using Gemini AI.
            </p>

            <div className="space-y-4">
              <textarea 
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 focus:ring-2 focus:ring-accent-500 focus:outline-none min-h-[100px]"
                placeholder="Describe the image..."
              />
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className={`w-full py-3 rounded-lg font-bold flex items-center justify-center gap-2 ${
                  isGenerating 
                    ? 'bg-purple-900/50 text-purple-200 cursor-wait' 
                    : 'bg-gradient-to-r from-purple-600 to-accent-600 text-white'
                }`}
              >
                {isGenerating ? 'Generating...' : 'Generate Image'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
