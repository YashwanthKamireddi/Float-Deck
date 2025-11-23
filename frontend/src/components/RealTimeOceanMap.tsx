import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Map, MapPin, Activity, Thermometer, Droplets, RefreshCw } from 'lucide-react';
import { floatAIAPI, ArgoFloat, DataFilters } from '@/services/api';

interface RealTimeOceanMapProps {
  filters?: DataFilters;
  highlightedFloats?: string[];
}

const RealTimeOceanMap = ({ filters, highlightedFloats = [] }: RealTimeOceanMapProps) => {
  const [floats, setFloats] = useState<ArgoFloat[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFloat, setSelectedFloat] = useState<ArgoFloat | null>(null);

  const loadFloats = async () => {
    setLoading(true);
    try {
      const { data } = await floatAIAPI.getArgoFloats(filters);
      setFloats(data);
    } catch (error) {
      console.error('Failed to load floats:', error);
      // Add some mock data if API fails
      const mockFloats: ArgoFloat[] = [
        {
          id: "mock_1",
          lat: 40.7,
          lon: -74.0,
          last_contact: "2024-01-15",
          temperature: 18.5,
          salinity: 35.2,
          trajectory: [[40.7, -74.0], [40.8, -73.9]],
          status: "active"
        },
        {
          id: "mock_2",
          lat: 35.6,
          lon: 139.7,
          last_contact: "2024-01-14",
          temperature: 22.1,
          salinity: 34.8,
          trajectory: [[35.6, 139.7], [35.7, 139.8]],
          status: "active"
        },
        {
          id: "mock_3",
          lat: -33.9,
          lon: 18.4,
          last_contact: "2024-01-13",
          temperature: 16.3,
          salinity: 35.0,
          trajectory: [[-33.9, 18.4], [-33.8, 18.5]],
          status: "delayed"
        }
      ];
      setFloats(mockFloats);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFloats();
  }, [filters]);

  const getFloatStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-accent';
      case 'delayed': return 'bg-yellow-500';
      case 'inactive': return 'bg-destructive';
      default: return 'bg-muted';
    }
  };

  const getFloatStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'active': return 'default';
      case 'delayed': return 'secondary';
      case 'inactive': return 'destructive';
      default: return 'outline';
    }
  };

  return (
    <div className="h-full w-full flex flex-col min-h-[600px]">
      <div className="flex items-center justify-between mb-4 px-4 pt-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Map className="w-5 h-5 text-blue-600" />
            Global ARGO Float Network
          </h3>
          <p className="text-sm text-muted-foreground">Real-time ocean profiling floats worldwide</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {floats.length} Active Floats
          </Badge>
          <Button onClick={loadFloats} disabled={loading} size="sm" variant="outline">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 px-4 pb-4 min-h-[500px]">
        {/* Interactive Map Area */}
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Ocean Temperature & Salinity Monitoring</CardTitle>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    Active
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                    Delayed
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-red-500"></div>
                    Inactive
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4 h-full">
              <div className="relative bg-gradient-to-b from-blue-50 via-blue-100 to-blue-200 rounded-lg h-full min-h-[400px] overflow-hidden border-2 border-blue-200">
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-30">
                    <div className="text-center">
                      <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-2" />
                      <p className="text-sm text-gray-600">Loading ocean data...</p>
                    </div>
                  </div>
                )}

                {/* Ocean Background with Currents */}
                <div className="absolute inset-0">
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-300/10 to-transparent animate-pulse"></div>
                  {/* Major Ocean Basins Labels */}
                  <div className="absolute top-4 left-4 text-xs font-medium text-blue-800 bg-white/80 px-2 py-1 rounded">
                    Pacific Ocean
                  </div>
                  <div className="absolute top-4 right-4 text-xs font-medium text-blue-800 bg-white/80 px-2 py-1 rounded">
                    Atlantic Ocean
                  </div>
                  <div className="absolute bottom-4 right-1/4 text-xs font-medium text-blue-800 bg-white/80 px-2 py-1 rounded">
                    Indian Ocean
                  </div>
                  {/* Equator Line */}
                  <div className="absolute top-1/2 left-0 right-0 h-px bg-yellow-400/60 transform -translate-y-1/2">
                    <span className="absolute left-2 -top-3 text-xs text-yellow-700 bg-white/80 px-1 rounded">Equator</span>
                  </div>
                </div>

                {/* Float Markers */}
                <div className="relative h-full">
                  {floats.map((float, index) => {
                    const isHighlighted = highlightedFloats.includes(float.id);
                    const x = ((float.lon + 180) / 360) * 100;
                    const y = ((90 - float.lat) / 180) * 100;

                    return (
                      <div
                        key={float.id}
                        className={`absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all duration-300 ${
                          isHighlighted ? 'scale-150 z-10' : 'hover:scale-125'
                        }`}
                        style={{
                          left: `${Math.max(5, Math.min(95, x))}%`,
                          top: `${Math.max(5, Math.min(95, y))}%`,
                        }}
                        onClick={() => setSelectedFloat(float)}
                        title={`Float ${float.id} - Lat: ${float.lat.toFixed(2)}°, Lon: ${float.lon.toFixed(2)}° - Status: ${float.status}`}
                      >
                        <div className={`w-4 h-4 rounded-full border-2 border-white shadow-lg transition-all duration-300 ${
                          float.status === 'active' ? 'bg-green-500 animate-pulse' :
                          float.status === 'delayed' ? 'bg-yellow-500' : 'bg-red-500'
                        }`}>
                          <div className={`absolute inset-0 rounded-full opacity-40 animate-ping ${
                            float.status === 'active' ? 'bg-green-500' :
                            float.status === 'delayed' ? 'bg-yellow-500' : 'bg-red-500'
                          }`}></div>
                        </div>
                        {(isHighlighted || selectedFloat?.id === float.id) && (
                          <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-3 py-1 rounded-md whitespace-nowrap z-20 shadow-lg">
                            <div className="font-medium">Float {float.id}</div>
                            <div>{float.lat.toFixed(2)}°N, {float.lon.toFixed(2)}°E</div>
                            <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Coordinates Grid */}
                <div className="absolute inset-0 pointer-events-none">
                  {/* Latitude lines */}
                  {[-60, -30, 0, 30, 60].map(lat => (
                    <div
                      key={`lat-${lat}`}
                      className="absolute w-full border-t border-white/20"
                      style={{ top: `${((90 - lat) / 180) * 100}%` }}
                    />
                  ))}
                  {/* Longitude lines */}
                  {[-120, -60, 0, 60, 120].map(lon => (
                    <div
                      key={`lon-${lon}`}
                      className="absolute h-full border-l border-white/20"
                      style={{ left: `${((lon + 180) / 360) * 100}%` }}
                    />
                  ))}
                </div>

                {/* Map Labels */}
                <div className="absolute top-2 left-2 text-xs text-white/80">
                  90°N
                </div>
                <div className="absolute bottom-2 left-2 text-xs text-white/80">
                  90°S
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Research Information & Float Details */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="w-4 h-4 text-green-600" />
                ARGO Network Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span>Active: {floats.filter(f => f.status === 'active').length}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                  <span>Delayed: {floats.filter(f => f.status === 'delayed').length}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  <span>Inactive: {floats.filter(f => f.status === 'inactive').length}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-3 h-3 text-blue-600" />
                  <span>Total: {floats.length}</span>
                </div>
              </div>

              <div className="pt-2 border-t text-xs text-muted-foreground">
                <p className="mb-1">📍 <strong>Coverage:</strong> Global ocean monitoring</p>
                <p className="mb-1">📊 <strong>Data:</strong> Temperature, salinity, pressure profiles</p>
                <p>🔄 <strong>Update:</strong> Every 10 days (typical cycle)</p>
              </div>
            </CardContent>
          </Card>

          {selectedFloat && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-blue-600" />
                  Float {selectedFloat.id} Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-muted-foreground">Latitude:</span>
                    <p className="font-medium">{selectedFloat.lat.toFixed(4)}°</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Longitude:</span>
                    <p className="font-medium">{selectedFloat.lon.toFixed(4)}°</p>
                  </div>
                </div>

                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <Badge variant={getFloatStatusBadgeVariant(selectedFloat.status)} className="ml-2">
                    {selectedFloat.status}
                  </Badge>
                </div>

                <div>
                  <span className="text-muted-foreground">Last Contact:</span>
                  <p className="font-medium">{selectedFloat.last_contact}</p>
                </div>

                <div>
                  <span className="text-muted-foreground">Temperature:</span>
                  <p className="font-medium">
                    {selectedFloat.temperature ? `${selectedFloat.temperature.toFixed(1)}°C` : 'No data'}
                  </p>
                </div>

                <div>
                  <span className="text-muted-foreground">Salinity:</span>
                  <p className="font-medium">
                    {selectedFloat.salinity ? `${selectedFloat.salinity.toFixed(2)} PSU` : 'No data'}
                  </p>
                </div>

                <div className="pt-2 mt-2 border-t">
                  <span className="text-muted-foreground text-xs">Research Applications:</span>
                  <div className="mt-1 space-y-1">
                    <Badge variant="outline" className="text-xs mr-1">
                      <Thermometer className="w-3 h-3 mr-1" />
                      Temperature
                    </Badge>
                    <Badge variant="outline" className="text-xs mr-1">
                      <Droplets className="w-3 h-3 mr-1" />
                      Salinity
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Research Quick Access</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-40 overflow-y-auto">
                {floats.slice(0, 8).map((float) => (
                  <div
                    key={float.id}
                    className={`p-3 border-b hover:bg-secondary/50 cursor-pointer transition-colors ${
                      selectedFloat?.id === float.id ? 'bg-secondary' : ''
                    } ${
                      highlightedFloats.includes(float.id) ? 'border-l-4 border-l-accent' : ''
                    }`}
                    onClick={() => setSelectedFloat(float)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${getFloatStatusColor(float.status)}`}></div>
                        <span className="font-mono text-sm">{float.id}</span>
                      </div>
                      <Badge variant={getFloatStatusBadgeVariant(float.status)} className="text-xs">
                        {float.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {float.lat.toFixed(2)}°, {float.lon.toFixed(2)}°
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {selectedFloat && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Float Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="text-sm font-medium">Float ID</div>
                  <div className="font-mono text-sm text-muted-foreground">{selectedFloat.id}</div>
                </div>

                <div>
                  <div className="text-sm font-medium">Position</div>
                  <div className="text-sm text-muted-foreground">
                    {selectedFloat.lat.toFixed(4)}°N, {selectedFloat.lon.toFixed(4)}°E
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium">Status</div>
                  <Badge variant={getFloatStatusBadgeVariant(selectedFloat.status)} className="text-xs">
                    {selectedFloat.status}
                  </Badge>
                </div>

                {selectedFloat.temperature && (
                  <div>
                    <div className="text-sm font-medium flex items-center gap-1">
                      <Thermometer className="w-3 h-3" />
                      Temperature
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {selectedFloat.temperature.toFixed(1)}°C
                    </div>
                  </div>
                )}

                {selectedFloat.salinity && (
                  <div>
                    <div className="text-sm font-medium flex items-center gap-1">
                      <Droplets className="w-3 h-3" />
                      Salinity
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {selectedFloat.salinity.toFixed(1)} PSU
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-sm font-medium">Last Contact</div>
                  <div className="text-sm text-muted-foreground">
                    {new Date(selectedFloat.last_contact).toLocaleDateString()}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default RealTimeOceanMap;
