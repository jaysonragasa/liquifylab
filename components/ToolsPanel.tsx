import React from 'react';
import { ToolType, BrushSettings, Layer, BlendMode } from '../types';
import { 
  Hand, 
  Maximize2, 
  Minimize2, 
  RotateCw, 
  Lasso,
  Layers,
  Eye,
  EyeOff,
  Trash2,
  Plus,
  ArrowUp,
  ArrowDown,
  Move
} from 'lucide-react';

interface ToolsPanelProps {
  activeTool: ToolType;
  setTool: (t: ToolType) => void;
  brushSettings: BrushSettings;
  setBrushSettings: (s: BrushSettings) => void;
  canUndo: boolean;
  layers: Layer[];
  activeLayerId: string;
  setActiveLayerId: (id: string) => void;
  toggleLayerVisibility: (id: string) => void;
  deleteLayer: (id: string) => void;
  moveLayer: (id: string, dir: 'up' | 'down') => void;
  addLayer: () => void;
  zoomLevel: number;
  setZoomLevel: (z: number) => void;
  updateLayer: (id: string, updates: Partial<Layer>) => void;
}

export const ToolsPanel: React.FC<ToolsPanelProps> = ({
  activeTool,
  setTool,
  brushSettings,
  setBrushSettings,
  canUndo,
  layers,
  activeLayerId,
  setActiveLayerId,
  toggleLayerVisibility,
  deleteLayer,
  moveLayer,
  addLayer,
  zoomLevel,
  setZoomLevel,
  updateLayer
}) => {
  
  const handleUndo = () => {
    window.dispatchEvent(new CustomEvent('liquify-undo'));
  };

  const tools = [
    { id: ToolType.TRANSFORM, icon: Move, label: 'Transform' },
    { id: ToolType.WARP, icon: Hand, label: 'Warp' },
    { id: ToolType.BLOAT, icon: Maximize2, label: 'Bloat' },
    { id: ToolType.PUCKER, icon: Minimize2, label: 'Pucker' },
    { id: ToolType.TWIRL_CW, icon: RotateCw, label: 'Twirl' },
    { id: ToolType.LASSO, icon: Lasso, label: 'Lasso' },
  ];

  const blendModes: BlendMode[] = ['source-over', 'multiply', 'screen', 'overlay', 'soft-light', 'difference'];

  const activeLayer = layers.find(l => l.id === activeLayerId);

  return (
    <div className="w-80 bg-gray-850 border-l border-gray-750 flex flex-col h-full text-sm shrink-0 overflow-y-auto">
      
      {/* Tools Section */}
      <div className="p-4 border-b border-gray-750">
        <h2 className="font-bold text-gray-100 mb-4">Tools</h2>
        <div className="grid grid-cols-3 gap-2">
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => setTool(tool.id)}
              className={`flex flex-col items-center justify-center p-2 rounded-lg transition-colors border text-xs ${
                activeTool === tool.id
                  ? 'bg-accent-600 border-accent-500 text-white'
                  : 'bg-gray-750 border-gray-700 text-gray-400 hover:bg-gray-700 hover:border-gray-600'
              }`}
            >
              <tool.icon className="w-5 h-5 mb-1" />
              <span>{tool.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Brush Settings */}
      {activeTool !== ToolType.LASSO && activeTool !== ToolType.TRANSFORM && (
        <div className="p-4 border-b border-gray-750">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-bold text-gray-100">Settings</h2>
          </div>
        
          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-gray-400 text-xs">Size</label>
                <span className="text-gray-200 text-xs">{brushSettings.size}px</span>
              </div>
              <input
                type="range"
                min="10"
                max="500"
                value={brushSettings.size}
                onChange={(e) => setBrushSettings({ ...brushSettings, size: Number(e.target.value) })}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-accent-500"
              />
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <label className="text-gray-400 text-xs">Strength</label>
                <span className="text-gray-200 text-xs">{Math.round(brushSettings.strength * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.01"
                max="1"
                step="0.01"
                value={brushSettings.strength}
                onChange={(e) => setBrushSettings({ ...brushSettings, strength: Number(e.target.value) })}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-accent-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Layer Options */}
      {activeLayer && (
         <div className="p-4 border-b border-gray-750">
           <h2 className="font-bold text-gray-100 mb-2">Layer Options</h2>
           <div className="space-y-3">
             <div>
               <label className="text-xs text-gray-400 block mb-1">Blend Mode</label>
               <select 
                 value={activeLayer.blendMode}
                 onChange={(e) => updateLayer(activeLayerId, { blendMode: e.target.value as BlendMode })}
                 className="w-full bg-gray-700 text-gray-200 text-xs p-2 rounded border border-gray-600 focus:outline-none focus:border-accent-500"
               >
                 {blendModes.map(m => (
                   <option key={m} value={m}>{m}</option>
                 ))}
               </select>
             </div>
             <div>
               <div className="flex justify-between mb-1">
                <label className="text-xs text-gray-400">Opacity</label>
                <span className="text-xs text-gray-200">{Math.round(activeLayer.opacity * 100)}%</span>
               </div>
               <input 
                 type="range"
                 min="0" max="1" step="0.01"
                 value={activeLayer.opacity}
                 onChange={(e) => updateLayer(activeLayerId, { opacity: Number(e.target.value) })}
                 className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-accent-500"
               />
             </div>
           </div>
         </div>
      )}

      {/* Layers List */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="p-4 border-b border-gray-750 flex items-center justify-between bg-gray-800">
           <h2 className="font-bold text-gray-100 flex items-center gap-2">
             <Layers className="w-4 h-4" /> Layers
           </h2>
           <button onClick={addLayer} className="p-1 hover:bg-gray-700 rounded" title="Duplicate/New Layer">
             <Plus className="w-4 h-4 text-white" />
           </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {[...layers].reverse().map((layer) => (
            <div 
              key={layer.id}
              className={`flex items-center gap-2 p-2 rounded-md cursor-pointer border ${
                activeLayerId === layer.id 
                  ? 'bg-accent-600/20 border-accent-500/50' 
                  : 'bg-gray-800 border-gray-700 hover:bg-gray-750'
              }`}
              onClick={() => setActiveLayerId(layer.id)}
            >
              <button onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}>
                {layer.visible ? <Eye className="w-4 h-4 text-gray-300" /> : <EyeOff className="w-4 h-4 text-gray-500" />}
              </button>
              
              <div className="flex-1 min-w-0">
                <p className={`text-sm truncate ${activeLayerId === layer.id ? 'text-white font-medium' : 'text-gray-300'}`}>
                  {layer.name}
                </p>
                <p className="text-[10px] text-gray-500">{layer.blendMode} • {Math.round(layer.opacity * 100)}%</p>
              </div>

              <div className="flex gap-1">
                 <button onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, 'up'); }} className="text-gray-400 hover:text-white">
                   <ArrowUp className="w-3 h-3" />
                 </button>
                 <button onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, 'down'); }} className="text-gray-400 hover:text-white">
                   <ArrowDown className="w-3 h-3" />
                 </button>
                 <button onClick={(e) => { e.stopPropagation(); deleteLayer(layer.id); }} className="text-red-400 hover:text-red-300 ml-1">
                   <Trash2 className="w-3 h-3" />
                 </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
