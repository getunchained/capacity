import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ChevronDown, Users, Clock, Target, Info, RefreshCw, ChevronsUpDown, TrendingUp, Download } from 'lucide-react';

// --- Helper Functions ---

/**
 * Normalizes a name to a consistent "FIRST LAST" format for reliable matching.
 * Handles "Last, First" (Names sheet) and "First Last" (Allocations sheet).
 */
const normalizeName = (name) => {
  if (!name) return '';
  if (name.includes(',')) {
    const [last, first] = name.split(',').map(n => n.trim());
    return `${first} ${last}`.toUpperCase();
  }
  return name.toUpperCase();
};

/** Parse a percentage string/number into a 0..1 float */
const parsePercent = (val) => {
  if (val === undefined || val === null || val === '') return 0;
  let n = typeof val === 'number' ? val : parseFloat(String(val).replace(/%/g, '').trim());
  if (isNaN(n)) return 0;
  // If the user typed 0-100, convert to 0-1
  if (n > 1) n = n / 100;
  // Clamp
  n = Math.max(0, Math.min(1, n));
  return n;
};

// --- Google Sheet Configuration ---
const SPREADSHEET_ID = "1EJE7oAN2Tyb3RxW3XBYaoRj4bcyrPaJhhzzBDFDj5Nw";

// --- Main App Component ---
const App = () => {
  // --- State Management ---
  const [namesData, setNamesData] = useState([]);
  const [allocationsData, setAllocationsData] = useState([]);
  const [totalAnnualBillableHours, setTotalAnnualBillableHours] = useState(2076); // Default value
  
  // Loading and Error State
  const [isLoading, setIsLoading] = useState(true);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [error, setError] = useState(null);

  // Filters
  const [selectedMonth, setSelectedMonth] = useState('All');
  const [selectedDepartment, setSelectedDepartment] = useState('All');

  // UI State
  const [activeEmployee, setActiveEmployee] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'percentToTarget', direction: 'descending' });


  // --- Data Fetching Logic ---
  const fetchDataFromSheet = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Fetch all sheets in parallel for better performance
      const [namesResponse, allocationsResponse, variablesResponse] = await Promise.all([
        fetch(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=Names`),
        fetch(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=Allocations`),
        fetch(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=Variables`)
      ]);

      // Process Names sheet
      if (!namesResponse.ok) throw new Error('Network response for Names sheet was not ok.');
      const namesText = await namesResponse.text();
      setNamesData(parseCsvData(namesText));

      // Process Allocations sheet
      if (!allocationsResponse.ok) throw new Error('Network response for Allocations sheet was not ok.');
      const allocationsText = await allocationsResponse.text();
      setAllocationsData(parseCsvData(allocationsText));

      // Process Variables sheet
      if (!variablesResponse.ok) throw new Error('Network response for Variables sheet was not ok.');
      const variablesText = await variablesResponse.text();
      const lines = variablesText.trim().split('\n');
      if (lines.length > 1) {
        // Simple CSV parse for the second row, second column (B2)
        const values = lines[1].split(',').map(v => v.replace(/"/g, '').trim());
        if (values.length > 1) {
            const annualHours = parseFloat(values[1]);
            if (!isNaN(annualHours)) {
                setTotalAnnualBillableHours(annualHours);
            }
        }
      }

      setIsDataLoaded(true);
    } catch (err) {
      console.error(err);
      setError(`Error fetching data. Please ensure the Google Sheet's sharing setting is "Anyone with the link can view" and all sheets (Names, Allocations, Variables) exist. Details: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDataFromSheet();
  }, [fetchDataFromSheet]);

  const parseCsvData = (csvText) => {
    if (!csvText) return [];
    const lines = csvText.trim().split('\n');
    const splitCsvLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result.map(val => val.replace(/^"|"$/g, ''));
    };

    const header = splitCsvLine(lines[0]);
    
    return lines.slice(1).map(line => {
        if (!line.trim()) return null;
        const values = splitCsvLine(line);
        const rowData = {};
        header.forEach((key, index) => {
            rowData[key] = values[index] || '';
        });
        return rowData;
    }).filter(Boolean);
  };

  // --- Memoized Calculations for Performance ---
  const analysis = useMemo(() => {
    if (!isDataLoaded || namesData.length === 0 || allocationsData.length === 0) return null;

    // Create a lookup map from the Names sheet. Key is normalized "FIRST LAST"
    const namesMap = new Map();
    namesData.forEach(person => {
        const normalized = normalizeName(person.Name);
        if (normalized) {
            namesMap.set(normalized, {
                department: person.Department,
                title: person.Title,
                billingTargetPercent: parsePercent(person['Percentage Billable']),
            });
        }
    });

    // Filter allocations based on UI selections
    const filteredAllocations = allocationsData.filter(alloc =>
        (selectedMonth === 'All' || alloc.Month === selectedMonth)
    );

    // Determine number of months in the current view for scaling
    const monthsInScope = selectedMonth === 'All' 
        ? new Set(allocationsData.map(a => a.Month).filter(Boolean)).size
        : 1;

    // Aggregate booked hours from filtered allocations
    const employeeMetrics = new Map();
    filteredAllocations.forEach(alloc => {
        const task = (alloc['Project (from Task)'] || '').toString().toUpperCase();
        
        // Per user request, do not include any hours from tasks with PTO or INT.
        if (task.includes('PTO') || task.includes('INT')) {
            return; // Skip this entire allocation record.
        }
        
        const normalizedResource = normalizeName(alloc.Resource);
        const personDetails = namesMap.get(normalizedResource);

        // Only include employees that are in the selected department
        if (personDetails && (selectedDepartment === 'All' || personDetails.department === selectedDepartment)) {
            if (!employeeMetrics.has(normalizedResource)) {
                employeeMetrics.set(normalizedResource, {
                    ...personDetails,
                    nameForDisplay: alloc.Resource, 
                    totalBookedHours: 0,
                    bookedBillable: 0,
                    bookedNonBillable: 0,
                    projects: [],
                });
            }

            const emp = employeeMetrics.get(normalizedResource);
            const hours = parseFloat(alloc['Estimated Hours']) || 0;
            
            // Since PTO/INT are filtered out, only PNB determines non-billable status.
            const isBillable = !task.includes('PNB');

            emp.totalBookedHours += hours;
            if (isBillable) {
                emp.bookedBillable += hours;
            } else {
                emp.bookedNonBillable += hours;
            }
            emp.projects.push({ name: alloc.Name, task: alloc['Project (from Task)'], hours, isBillable });
        }
    });

    // Finalize employee data with calculations
    const employees = Array.from(employeeMetrics.values()).map(e => {
        // Use the dynamic annual hours value from the sheet
        const monthlyRequired = e.billingTargetPercent * (totalAnnualBillableHours / 12);
        const requiredBillableHours = monthlyRequired * monthsInScope;
        
        // % to Target = (Booked Billable) / (Required Billable)
        const percentToTarget = requiredBillableHours > 0 ? (e.bookedBillable / requiredBillableHours) * 100 : 0;

        return {
            ...e,
            requiredBillableHours,
            targetPercentDisplay: e.billingTargetPercent * 100,
            percentToTarget,
            utilization: percentToTarget, // for charts
        };
    });

    // Aggregate by department
    const departmentMap = new Map();
    employees.forEach(e => {
        if (!departmentMap.has(e.department)) {
            departmentMap.set(e.department, {
                name: e.department,
                bookedBillable: 0,
                requiredBillableHours: 0,
            });
        }
        const dept = departmentMap.get(e.department);
        dept.bookedBillable += e.bookedBillable;
        dept.requiredBillableHours += e.requiredBillableHours;
    });

    const departments = Array.from(departmentMap.values()).map(d => ({
        ...d,
        utilization: d.requiredBillableHours > 0 ? (d.bookedBillable / d.requiredBillableHours) * 100 : 0,
    }));

    // Calculate overall totals
    const overall = {
        bookedBillable: employees.reduce((s, e) => s + e.bookedBillable, 0),
        bookedNonBillable: employees.reduce((s, e) => s + e.bookedNonBillable, 0),
        totalBookedHours: employees.reduce((s, e) => s + e.totalBookedHours, 0),
        requiredBillableHours: employees.reduce((s, e) => s + e.requiredBillableHours, 0),
        employeeCount: employees.length,
        monthsInScope,
    };
    overall.utilization = overall.requiredBillableHours > 0 ? (overall.bookedBillable / overall.requiredBillableHours) * 100 : 0;

    return { employees, departments, overall };
  }, [isDataLoaded, namesData, allocationsData, selectedMonth, selectedDepartment, totalAnnualBillableHours]);

  // --- Derived State for UI ---
  const uniqueDepartments = useMemo(() => {
    if (!isDataLoaded) return ['All'];
    
    // Create a map of normalized names to departments from the "Names" sheet
    const namesDeptMap = new Map();
    namesData.forEach(person => {
        const normalized = normalizeName(person.Name);
        if (normalized) {
            namesDeptMap.set(normalized, person.Department);
        }
    });

    // Find all departments that have at least one valid allocation
    const departmentsWithAllocations = new Set();
    allocationsData.forEach(alloc => {
        const task = (alloc['Project (from Task)'] || '').toString().toUpperCase();
        if (task.includes('PTO') || task.includes('INT')) {
            return;
        }
        const normalizedResource = normalizeName(alloc.Resource);
        const department = namesDeptMap.get(normalizedResource);
        if (department) {
            departmentsWithAllocations.add(department);
        }
    });

    return ['All', ...Array.from(departmentsWithAllocations).sort()];
  }, [isDataLoaded, namesData, allocationsData]);

  const uniqueMonths = useMemo(() => ['All', ...new Set(allocationsData.map(d => d.Month).filter(Boolean))], [allocationsData]);
  
  const sortedEmployees = useMemo(() => {
    if (!analysis?.employees) return [];
    let sortableItems = [...analysis.employees];
    if (sortConfig.key) {
        sortableItems.sort((a, b) => {
            const valA = a[sortConfig.key];
            const valB = b[sortConfig.key];
            
            if (typeof valA === 'string') {
                return sortConfig.direction === 'ascending' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
            if (valA < valB) {
                return sortConfig.direction === 'ascending' ? -1 : 1;
            }
            if (valA > valB) {
                return sortConfig.direction === 'ascending' ? 1 : -1;
            }
            return 0;
        });
    }
    return sortableItems;
  }, [analysis?.employees, sortConfig]);

  const requestSort = (key) => {
    let direction = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
        direction = 'descending';
    }
    setSortConfig({ key, direction });
  };
  
  const getSortIcon = (key) => {
    if (sortConfig.key !== key) {
        return <ChevronsUpDown className="w-4 h-4 ml-1 text-slate-400" />;
    }
    if (sortConfig.direction === 'ascending') {
        return <ChevronDown className="w-4 h-4 ml-1" />;
    }
    return <ChevronDown className="w-4 h-4 ml-1 transform rotate-180" />;
  };

  const handleExport = () => {
    if (!sortedEmployees || sortedEmployees.length === 0) {
        alert("No data available to export.");
        return;
    }

    const headers = [
        "First Last",
        "Title",
        "Department",
        "Billable Hrs/Mo Required for Role",
        "Hrs Booked",
        "Target %",
        "% to Target"
    ];

    const csvRows = [headers.join(',')];

    sortedEmployees.forEach(e => {
        const row = [
            `"${e.nameForDisplay}"`,
            `"${e.title}"`,
            `"${e.department}"`,
            e.requiredBillableHours.toFixed(2),
            e.totalBookedHours.toFixed(2),
            e.targetPercentDisplay.toFixed(0),
            e.percentToTarget.toFixed(2)
        ];
        csvRows.push(row.join(','));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'capacity_report.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  // --- Render Functions & Components ---
  const StatCard = ({ icon, title, value, subtext, color }) => (
    <div className="bg-white p-6 rounded-2xl shadow-sm flex items-start space-x-4">
      <div className={`p-3 rounded-full ${color}`}>{icon}</div>
      <div>
        <p className="text-slate-500 text-sm font-medium">{title}</p>
        <p className="text-3xl font-bold text-slate-800">{value}</p>
        <p className="text-slate-400 text-xs">{subtext}</p>
      </div>
    </div>
  );

  return (
    <div className="bg-slate-100 min-h-screen p-4 md:p-8 font-sans text-slate-800">
      <header className="mb-8 flex flex-wrap gap-4 justify-between items-center">
        <div>
          <h1 className="text-4xl font-bold text-slate-800">Capacity Planning Dashboard</h1>
          <p className="text-slate-500 mt-1">Live data from Google Sheets</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-slate-500 bg-white px-3 py-2 rounded-lg shadow-sm border border-slate-200">
            View scope: <span className="font-semibold">{selectedMonth === 'All' ? `${analysis?.overall.monthsInScope || 1} months` : '1 month'}</span>
          </div>
           <button onClick={handleExport} disabled={!isDataLoaded || !analysis} className="flex items-center gap-2 bg-green-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md hover:bg-green-700 transition disabled:bg-slate-300 disabled:cursor-not-allowed">
            <Download className="w-5 h-5" />
            Export to Excel
          </button>
          <button onClick={fetchDataFromSheet} disabled={isLoading} className="flex items-center gap-2 bg-indigo-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md hover:bg-indigo-700 transition disabled:bg-slate-300 disabled:cursor-not-allowed">
            <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`}/>
            Refresh Data
          </button>
        </div>
      </header>

      {isLoading && <div className="text-center p-10 font-semibold text-slate-600">Syncing with Google Sheets...</div>}
      {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative" role="alert"><strong className="font-bold">Error:</strong><span className="block sm:inline ml-2">{error}</span></div>}

      {!isDataLoaded && !isLoading && !error && (
        <div className="text-center bg-white p-12 rounded-2xl shadow-sm">
          <h2 className="text-2xl font-semibold text-slate-700">Waiting for data...</h2>
          <p className="text-slate-500 mt-2 max-w-md mx-auto">If the app doesn't load, please ensure your Google Sheet sharing is set to "Anyone with the link can view".</p>
        </div>
      )}

      {isDataLoaded && analysis && (
        <>
          <div className="bg-white/50 backdrop-blur-sm p-4 rounded-2xl shadow-sm mb-8 sticky top-4 z-10">
            <div className="flex flex-wrap items-center gap-4">
              <span className="font-semibold">Filters:</span>
              <div className="relative">
                <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="appearance-none bg-white border border-slate-300 rounded-lg py-2 pl-3 pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition">
                  {uniqueMonths.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
              <div className="relative">
                <select value={selectedDepartment} onChange={e => setSelectedDepartment(e.target.value)} className="appearance-none bg-white border border-slate-300 rounded-lg py-2 pl-3 pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition">
                  {uniqueDepartments.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
              <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded-lg ml-auto">
                <Info className="w-5 h-5 text-blue-500" />
                <p className="text-sm text-blue-700">Displaying data for <span className="font-bold">{selectedDepartment}</span> in <span className="font-bold">{selectedMonth}</span>.</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
              <StatCard icon={<Target className="w-6 h-6 text-green-800"/>} title="Overall % to Target" value={`${analysis.overall.utilization.toFixed(1)}%`} subtext={`Booked Billable / Required Billable`} color="bg-green-200" />
              <StatCard icon={<Users className="w-6 h-6 text-indigo-800"/>} title="Active Resources" value={analysis.overall.employeeCount} subtext="Employees with allocated hours" color="bg-indigo-200" />
              <StatCard icon={<Clock className="w-6 h-6 text-amber-800"/>} title="Total Hours Booked" value={analysis.overall.totalBookedHours.toLocaleString()} subtext="Excludes PTO & INT" color="bg-amber-200" />
              <StatCard icon={<TrendingUp className="w-6 h-6 text-sky-800"/>} title="Total Billable Hours Available" value={analysis.overall.requiredBillableHours.toLocaleString(undefined, {maximumFractionDigits: 0})} subtext={`Based on ${totalAnnualBillableHours} annual hours`} color="bg-sky-200" />
          </div>

          <div className="grid grid-cols-1 gap-8">
              <div className="bg-white p-6 rounded-2xl shadow-sm">
                <h3 className="font-bold text-lg mb-4 text-slate-700">Department % to Target</h3>
                <div className="w-full h-96">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analysis.departments} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: '#64748b' }}/>
                      <YAxis unit="%" tick={{ fill: '#64748b' }} />
                      <Tooltip cursor={{fill: 'rgba(79, 70, 229, 0.1)'}} contentStyle={{backgroundColor: 'white', borderRadius: '0.75rem', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'}}/>
                      <Legend />
                      <Bar dataKey="utilization" name="% to Target" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm">
                <h3 className="font-bold text-lg mb-4 text-slate-700">Resource Details</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="p-3 text-sm font-semibold text-slate-500 w-1/4">
                            <button onClick={() => requestSort('nameForDisplay')} className="flex items-center w-full text-left">Employee Name {getSortIcon('nameForDisplay')}</button>
                        </th>
                        <th className="p-3 text-sm font-semibold text-slate-500 w-1/6">
                            <button onClick={() => requestSort('department')} className="flex items-center w-full text-left">Department {getSortIcon('department')}</button>
                        </th>
                        <th className="p-3 text-sm font-semibold text-slate-500 text-right w-48">
                            <button onClick={() => requestSort('requiredBillableHours')} className="flex items-center w-full justify-end text-right">Billable Hrs/Mo Required for Role {getSortIcon('requiredBillableHours')}</button>
                        </th>
                        <th className="p-3 text-sm font-semibold text-slate-500 text-right w-24">
                            <button onClick={() => requestSort('totalBookedHours')} className="flex items-center w-full justify-end">Hrs Booked {getSortIcon('totalBookedHours')}</button>
                        </th>
                        <th className="p-3 text-sm font-semibold text-slate-500 text-right w-24">
                            <button onClick={() => requestSort('targetPercentDisplay')} className="flex items-center w-full justify-end">Target % {getSortIcon('targetPercentDisplay')}</button>
                        </th>
                        <th className="p-3 text-sm font-semibold text-slate-500 text-right w-36">
                            <button onClick={() => requestSort('percentToTarget')} className="flex items-center w-full justify-end">% to Target {getSortIcon('percentToTarget')}</button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedEmployees.map(e => (
                        <tr key={e.nameForDisplay} onClick={() => setActiveEmployee(e)} className="hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-b-0">
                          <td className="p-3 font-semibold">{e.nameForDisplay} <span className="block text-xs font-normal text-slate-400">{e.title}</span></td>
                          <td className="p-3">{e.department}</td>
                          <td className="p-3 text-right font-medium">{e.requiredBillableHours.toFixed(1)}</td>
                          <td className="p-3 text-right">{e.totalBookedHours.toFixed(1)}</td>
                          <td className="p-3 text-right">{e.targetPercentDisplay.toFixed(0)}%</td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <span className="font-bold text-indigo-600">{e.percentToTarget.toFixed(1)}%</span>
                              <div className="w-16 bg-slate-200 rounded-full h-2">
                                <div className="bg-indigo-500 h-2 rounded-full" style={{ width: `${Math.min(e.percentToTarget, 100)}%` }}></div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
          </div>
        </>
      )}

      {activeEmployee && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setActiveEmployee(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-8" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold">{activeEmployee.nameForDisplay}</h2>
                <p className="text-slate-500">{activeEmployee.title} - {activeEmployee.department}</p>
              </div>
              <button onClick={() => setActiveEmployee(null)} className="text-slate-400 hover:text-slate-800 text-3xl leading-none">&times;</button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-6 text-center">
              <div>
                <p className="text-xs text-slate-500">Billable Hrs/Mo Required</p>
                <p className="text-xl font-bold">{activeEmployee.requiredBillableHours.toFixed(1)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Booked Billable</p>
                <p className="text-xl font-bold">{activeEmployee.bookedBillable.toFixed(1)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Target %</p>
                <p className="text-xl font-bold">{activeEmployee.targetPercentDisplay.toFixed(0)}%</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">% to Target</p>
                <p className="text-xl font-bold text-indigo-600">{activeEmployee.percentToTarget.toFixed(1)}%</p>
              </div>
            </div>

            <h3 className="font-semibold text-lg mb-2">Project Breakdown for {selectedMonth}</h3>
            <div className="max-h-64 overflow-y-auto pr-2">
              <ul>
                {activeEmployee.projects.map((p, i) => (
                  <li key={i} className="flex justify-between items-center p-3 rounded-lg hover:bg-slate-50">
                    <div>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-sm text-slate-500">{p.task}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">{p.hours.toFixed(1)} hrs</p>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${p.isBillable ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{p.isBillable ? 'Billable' : 'Non-Billable'}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
