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
  if (n > 1) n = n / 100;
  return Math.max(0, Math.min(1, n));
};

/** Gets the current month and year in "Mon YYYY" format */
const getCurrentMonthYear = () => {
  const now = new Date();
  return now.toLocaleString('en-US', { month: 'short', year: 'numeric' });
};

/** --------- Local date helpers (fix UTC off-by-one) --------- **/
const formatDateLocal = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseYMDToLocalDate = (ymd) => {
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};
/** ----------------------------------------------------------- **/

/**
 * Calculates the number of business days between two dates (inclusive).
 * Mon–Fri only. Normalized to LOCAL midnight to avoid timezone drift.
 */
const getBusinessDays = (startDate, endDate) => {
  if (!(startDate instanceof Date) || !(endDate instanceof Date)) return 0;

  // normalize to local midnight
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end   = new Date(endDate.getFullYear(),   endDate.getMonth(),   endDate.getDate());
  if (start > end) return 0;

  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
};

/**
 * Gets the start and end dates of the current month (YYYY-MM-DD, LOCAL).
 */
const getCurrentMonthDateRange = () => {
  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
  const endDate   = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { start: formatDateLocal(startDate), end: formatDateLocal(endDate) };
};

/**
 * Parses a "Mon YYYY" string to get the start and end date objects for that month.
 */
const getDateRangeFromMonthYear = (monthYearStr) => {
  const [monthAbbr, year] = monthYearStr.split(' ');
  const startDate = new Date(`${monthAbbr} 1, ${year}`);
  const endDate   = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
  return { startDate, endDate };
};

// --- Google Sheet Configuration ---
const SPREADSHEET_ID = "1EJE7oAN2Tyb3RxW3XBYaoRj4bcyrPaJhhzzBDFDj5Nw";

const totalAnnualBusinessDays = 260; 
const TOTAL_ANNUAL_HOURS = 2080;

// --- Custom Components ---
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const utilizationOfPotential = data.totalPotentialHours > 0 ? (data.bookedBillable / data.totalPotentialHours) * 100 : 0;
    return (
      <div className="bg-white p-4 rounded-lg shadow-lg border border-slate-200 w-64">
        <p className="font-bold text-slate-800 mb-2">{label}</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Utilization (vs Target):</span>
            <span className="font-semibold text-indigo-600">{data.utilization.toFixed(1)}%</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Utilization (vs Potential):</span>
            <span className="font-semibold">{utilizationOfPotential.toFixed(1)}%</span>
          </div>
          <hr className="my-1"/>
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Total Potential Hours:</span>
            <span className="font-semibold">{data.totalPotentialHours.toLocaleString(undefined, {maximumFractionDigits: 0})}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Total Required Hours:</span>
            <span className="font-semibold">{data.requiredBillableHours.toLocaleString(undefined, {maximumFractionDigits: 1})}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Hours Booked:</span>
            <span className="font-semibold">{data.totalBookedHours.toLocaleString(undefined, {maximumFractionDigits: 1})}</span>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

// --- Main App Component ---
const App = () => {
  const [namesData, setNamesData] = useState([]);
  const [allocationsData, setAllocationsData] = useState([]);
  const [totalAnnualBillableHours] = useState(TOTAL_ANNUAL_HOURS);
  const [isLoading, setIsLoading] = useState(true);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [filterMode, setFilterMode] = useState('month');
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthYear());
  const currentMonthRange = getCurrentMonthDateRange();
  const [startDate, setStartDate] = useState(currentMonthRange.start);
  const [endDate, setEndDate] = useState(currentMonthRange.end);
  const [selectedDepartment, setSelectedDepartment] = useState('All');
  const [filters, setFilters] = useState({ env: false, pnb: false });
  const [activeEmployee, setActiveEmployee] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'percentToTarget', direction: 'descending' });

  const fetchDataFromSheet = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [namesResponse, allocationsResponse] = await Promise.all([
        fetch(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=Names`),
        fetch(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=Allocations`),
      ]);
      if (!namesResponse.ok) throw new Error('Network response for Names sheet was not ok.');
      const namesText = await namesResponse.text();
      setNamesData(parseCsvData(namesText));
      if (!allocationsResponse.ok) throw new Error('Network response for Allocations sheet was not ok.');
      const allocationsText = await allocationsResponse.text();
      setAllocationsData(parseCsvData(allocationsText));
      setIsDataLoaded(true);
    } catch (err) {
      console.error(err);
      setError(`Error fetching data. Please ensure the Google Sheet's sharing setting is "Anyone with the link can view" and all sheets (Names, Allocations, Variables) exist. Details: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchDataFromSheet(); }, [fetchDataFromSheet]);

  const parseCsvData = (csvText) => {
    if (!csvText) return [];
    const lines = csvText.trim().split('\n');

    const splitCsvLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') inQuotes = !inQuotes;
        else if (char === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
        else current += char;
      }
      result.push(current.trim());
      return result.map(val => val.replace(/^"|"$/g, ''));
    };

    const header = splitCsvLine(lines[0]);
    const currentYear = new Date().getFullYear();

    return lines.slice(1).map(line => {
      if (!line.trim()) return null;
      const values = splitCsvLine(line);
      const rowData = {};
      header.forEach((key, index) => {
        let value = values[index] || '';
        if (key === 'Start Date' || key === 'End Date') {
          if (value) {
            if (value.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
              // parse to LOCAL date
              const [mm, dd, yyyy] = value.split('/').map(Number);
              value = new Date(yyyy, mm - 1, dd);
            } else if (value.match(/^[A-Za-z]{3}-\d{1,2}$/)) {
              const [monthAbbr, day] = value.split('-');
              value = new Date(`${monthAbbr} ${day}, ${currentYear}`);
            }
          }
        } else if (key === 'Estimated Hours') {
          value = parseFloat(value) || 0;
        }
        rowData[key] = value;
      });
      return rowData;
    }).filter(Boolean);
  };

  const analysis = useMemo(() => {
    if (!isDataLoaded || namesData.length === 0 || allocationsData.length === 0) return null;

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

    let filteredAllocations = [];
    let totalBusinessDaysInScope = 0;

    let startPeriod, endPeriod;
    if (filterMode === 'month') {
      const { startDate: mStart, endDate: mEnd } = getDateRangeFromMonthYear(selectedMonth);
      startPeriod = mStart;
      endPeriod = mEnd;
      totalBusinessDaysInScope = getBusinessDays(startPeriod, endPeriod);

      // If using Month field, keep as-is; assumes rows are already monthly buckets
      filteredAllocations = allocationsData.filter(alloc => alloc.Month === selectedMonth);

    } else if (filterMode === 'dateRange' && startDate && endDate) {
      // parse to LOCAL dates from YYYY-MM-DD inputs
      startPeriod = parseYMDToLocalDate(startDate);
      endPeriod   = parseYMDToLocalDate(endDate);
      totalBusinessDaysInScope = getBusinessDays(startPeriod, endPeriod);

      allocationsData.forEach(alloc => {
        const allocStart = alloc['Start Date'];
        const allocEnd   = alloc['End Date'];

        if (allocStart instanceof Date && allocEnd instanceof Date && !isNaN(allocStart) && !isNaN(allocEnd)) {
          const overlapStart = new Date(Math.max(allocStart, startPeriod));
          const overlapEnd   = new Date(Math.min(allocEnd, endPeriod));
          // Keep overlap whole days in local time
          const oStart = new Date(overlapStart.getFullYear(), overlapStart.getMonth(), overlapStart.getDate());
          const oEnd   = new Date(overlapEnd.getFullYear(),   overlapEnd.getMonth(),   overlapEnd.getDate());

          if (oStart <= oEnd) {
            const totalAllocBusinessDays = getBusinessDays(allocStart, allocEnd);
            const overlapBusinessDays    = getBusinessDays(oStart, oEnd);
            const estimatedHours = alloc['Estimated Hours'];

            if (totalAllocBusinessDays > 0) {
              const proratedHours = (estimatedHours / totalAllocBusinessDays) * overlapBusinessDays;
              if (proratedHours > 0) {
                filteredAllocations.push({ ...alloc, 'Estimated Hours': proratedHours });
              }
            }
          }
        }
      });
    }

    const employeeMetrics = new Map();
    filteredAllocations.forEach(alloc => {
      const projectFromTask = (alloc['Project (from Task)'] || '').toString();

      // Classification flags
      const hasPTO = projectFromTask.includes('[PTO]');
      const hasINT = projectFromTask.includes('[INT]');
      const isENV  = projectFromTask.includes('[ENV]');
      const isPNB  = projectFromTask.toUpperCase().includes('PNB:');

      // Respect toggles: [ENV] and [PNB] control inclusion in lists/counts
      if (!filters.env && isENV) return;
      if (!filters.pnb && isPNB) return;

      const normalizedResource = normalizeName(alloc.Resource);
      const personDetails = namesMap.get(normalizedResource);
      if (personDetails && (selectedDepartment === 'All' || personDetails.department === selectedDepartment)) {
        if (!employeeMetrics.has(normalizedResource)) {
          employeeMetrics.set(normalizedResource, {
            ...personDetails,
            nameForDisplay: alloc.Resource,
            totalBookedHours: 0,      // excludes PTO/INT
            bookedBillable: 0,        // excludes PTO/INT
            bookedNonBillable: 0,     // excludes PTO/INT
            ptoHours: 0,              // NEW
            intHours: 0,              // NEW
            projects: new Map(),
          });
        }
        const emp = employeeMetrics.get(normalizedResource);
        const hours = alloc['Estimated Hours'];

        // PTO/INT are tracked but do not impact required or booked billable
        if (hasPTO) {
          emp.ptoHours += hours;
        } else if (hasINT) {
          emp.intHours += hours;
        } else {
          // normal path: PNB is non-billable, others billable
          const isBillable = !isPNB;
          emp.totalBookedHours += hours;
          if (isBillable) emp.bookedBillable += hours;
          else emp.bookedNonBillable += hours;
        }

        // Include PTO/INT in the project list as Not Billable
        const truncatedProjectName = (alloc.Name || '').split(':')[0].trim();
        const keySuffix = hasPTO ? 'PTO' : hasINT ? 'INT' : isPNB ? 'PNB' : 'GEN';
        const projectKey = `${normalizedResource}-${truncatedProjectName}-${keySuffix}`;
        if (!emp.projects.has(projectKey)) {
          emp.projects.set(projectKey, {
            name: truncatedProjectName || (alloc['Project (from Task)'] || '').split(':')[0].trim(),
            task: (alloc['Project (from Task)'] || '').split(':')[0].trim(),
            hours: 0,
            // PTO/INT/PNB are Not Billable for display
            isBillable: !(hasPTO || hasINT || isPNB),
          });
        }
        emp.projects.get(projectKey).hours += hours;
      }
    });

    const allEmployees = Array.from(employeeMetrics.values()).map(e => {
      const totalRequiredBillableHours =
        (e.billingTargetPercent * TOTAL_ANNUAL_HOURS / totalAnnualBusinessDays) * totalBusinessDaysInScope;
      const percentToTarget = totalRequiredBillableHours > 0 ? (e.bookedBillable / totalRequiredBillableHours) * 100 : 0;
      const potentialHours = (TOTAL_ANNUAL_HOURS / totalAnnualBusinessDays) * totalBusinessDaysInScope;
      const utilizationPercent = potentialHours > 0 ? (e.totalBookedHours / potentialHours) * 100 : 0;
      return {
        ...e,
        projects: Array.from(e.projects.values()),
        requiredBillableHours: totalRequiredBillableHours,
        targetPercentDisplay: e.billingTargetPercent * 100,
        percentToTarget,
        utilization: percentToTarget,
        utilizationPercent,
        ptoHours: e.ptoHours,
        intHours: e.intHours,
      };
    });

    // Totals (using employees with at least some billable to avoid noise)
    const activeEmployeesForTotals = allEmployees.filter(e => e.bookedBillable >= 1);
    const departmentMap = new Map();
    activeEmployeesForTotals.forEach(e => {
      if (!departmentMap.has(e.department)) {
        departmentMap.set(e.department, {
          name: e.department,
          bookedBillable: 0,
          requiredBillableHours: 0,
          totalBookedHours: 0,
          employeeCount: 0,
        });
      }
      const dept = departmentMap.get(e.department);
      dept.bookedBillable        += e.bookedBillable;
      dept.requiredBillableHours += e.requiredBillableHours;
      dept.totalBookedHours      += e.totalBookedHours;
      dept.employeeCount         += 1;
    });

    const departments = Array.from(departmentMap.values()).map(d => {
      const totalPotentialHours =
        (TOTAL_ANNUAL_HOURS / totalAnnualBusinessDays) * totalBusinessDaysInScope * d.employeeCount;
      return {
        ...d,
        utilization: d.requiredBillableHours > 0 ? (d.bookedBillable / d.requiredBillableHours) * 100 : 0,
        totalPotentialHours,
      };
    });

    const overall = {
      bookedBillable: activeEmployeesForTotals.reduce((s, e) => s + e.bookedBillable, 0),
      bookedNonBillable: activeEmployeesForTotals.reduce((s, e) => s + e.bookedNonBillable, 0),
      totalBookedHours: activeEmployeesForTotals.reduce((s, e) => s + e.totalBookedHours, 0),
      requiredBillableHours: activeEmployeesForTotals.reduce((s, e) => s + e.requiredBillableHours, 0),
      employeeCount: activeEmployeesForTotals.length,
      totalBusinessDaysInScope,
    };
    overall.utilization = overall.requiredBillableHours > 0
      ? (overall.bookedBillable / overall.requiredBillableHours) * 100
      : 0;

    return { employees: allEmployees, departments, overall, totalBusinessDaysInScope };
  }, [isDataLoaded, namesData, allocationsData, selectedMonth, selectedDepartment, totalAnnualBillableHours, filters, filterMode, startDate, endDate]);

  const uniqueDepartments = useMemo(() => {
    if (!isDataLoaded) return ['All'];
    const namesDeptMap = new Map();
    namesData.forEach(person => {
      const normalized = normalizeName(person.Name);
      if (normalized) namesDeptMap.set(normalized, person.Department);
    });
    const departmentsWithAllocations = new Set();
    allocationsData.forEach(alloc => {
      const projectFromTask = (alloc['Project (from Task)'] || '').toString();
      // PTO/INT/ENV/PNB rows don't gate department visibility
      if (projectFromTask.includes('[PTO]') || projectFromTask.includes('[INT]') || projectFromTask.includes('[ENV]') || projectFromTask.toUpperCase().includes('PNB:')) return;
      const normalizedResource = normalizeName(alloc.Resource);
      const department = namesDeptMap.get(normalizedResource);
      if (department) departmentsWithAllocations.add(department);
    });
    return ['All', ...Array.from(departmentsWithAllocations).sort()];
  }, [isDataLoaded, namesData, allocationsData]);

  const uniqueMonths = useMemo(() => {
    const months = [...new Set(allocationsData.map(d => d.Month).filter(Boolean))];
    const sortedMonths = months.sort((a, b) => {
      const dateA = new Date(a);
      const dateB = new Date(b);
      if (isNaN(dateA) || isNaN(dateB)) return a.localeCompare(b);
      const yearA = dateA.getFullYear();
      const yearB = dateB.getFullYear();
      if (yearA !== yearB) return yearA - yearB;
      return dateA.getMonth() - dateB.getMonth();
    });
    return ['All', ...sortedMonths];
  }, [allocationsData]);

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
        if (valA < valB) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'ascending' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [analysis?.employees, sortConfig]);

  const requestSort = (key) => {
    let direction = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') direction = 'descending';
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return <ChevronsUpDown className="w-4 h-4 ml-1 text-slate-400" />;
    if (sortConfig.direction === 'ascending') return <ChevronDown className="w-4 h-4 ml-1" />;
    return <ChevronDown className="w-4 h-4 ml-1 transform rotate-180" />;
  };

  const handleExport = () => {
    if (!isDataLoaded || !analysis) {
      alert("No data available to export.");
      return;
    }
    const headers = ["First Last", "Title", "Department", "Required Hrs", "Hrs Booked", "Target %", "% of Target", "PTO Hrs", "INT Hrs"];
    const csvRows = [headers.join(',')];
    sortedEmployees.forEach(e => {
      const row = [
        `"${e.nameForDisplay}"`,
        `"${e.title}"`,
        `"${e.department}"`,
        e.requiredBillableHours.toFixed(2),
        e.totalBookedHours.toFixed(2),
        e.targetPercentDisplay.toFixed(0),
        e.percentToTarget.toFixed(2),
        e.ptoHours.toFixed(2),
        e.intHours.toFixed(2),
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

  const handleBarClick = (data) => {
    if (data && data.activePayload && data.activePayload.length > 0) {
      const departmentName = data.activePayload[0].payload.name;
      setSelectedDepartment(departmentName);
    }
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
      <style>{`
        .recharts-bar-rectangle:hover { cursor: pointer; opacity: 0.9; }
        .filter-button { display:flex; align-items:center; padding:8px 16px; border-radius:8px; cursor:pointer; font-weight:600; color:#475569; transition:all .2s; }
        .filter-button:hover { background-color:#f1f5f9; }
        .filter-button.active { background-color:#e2e8f0; border:1px solid #3b82f6; box-shadow:0 0 0 2px rgba(59,130,246,.5); }
      `}</style>

      <header className="mb-8 flex flex-wrap gap-4 justify-between items-center">
        <div>
          <h1 className="text-4xl font-bold text-slate-800">Capacity Planning Dashboard</h1>
          <p className="text-slate-500 mt-1">Live data from Google Sheets</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-slate-500 bg-white px-3 py-2 rounded-lg shadow-sm border border-slate-200">
            View scope: <span className="font-semibold">{filterMode === 'month' ? selectedMonth : `${startDate} to ${endDate}`}</span>
          </div>
          <button onClick={handleExport} disabled={!isDataLoaded || !analysis} className="flex items-center gap-2 bg-green-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md hover:bg-green-700 transition disabled:bg-slate-300 disabled:cursor-not-allowed">
            <Download className="w-5 h-5" /> Export to Excel
          </button>
          <button onClick={fetchDataFromSheet} disabled={isLoading} className="flex items-center gap-2 bg-indigo-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md hover:bg-indigo-700 transition disabled:bg-slate-300 disabled:cursor-not-allowed">
            <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`}/> Refresh Data
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

              <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1 border border-slate-300 shadow-sm">
                <button
                  className={`filter-button ${filterMode === 'month' ? 'active bg-white' : ''}`}
                  onClick={() => setFilterMode('month')}
                >
                  Month
                </button>
                <button
                  className={`filter-button ${filterMode === 'dateRange' ? 'active bg-white' : ''}`}
                  onClick={() => {
                    setFilterMode('dateRange');
                    const { startDate: monthStart, endDate: monthEnd } = getDateRangeFromMonthYear(selectedMonth);
                    setStartDate(formatDateLocal(monthStart));
                    setEndDate(formatDateLocal(monthEnd));
                  }}
                >
                  Date Range
                </button>
              </div>

              {filterMode === 'month' && (
                <div className="relative">
                  <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="appearance-none bg-white border border-slate-300 rounded-lg py-2 pl-3 pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition">
                    {uniqueMonths.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              )}

              {filterMode === 'dateRange' && (
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="bg-white border border-slate-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                  />
                  <span className="text-slate-500">to</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="bg-white border border-slate-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                  />
                </div>
              )}

              <div className="flex items-center gap-2 p-2 ml-4 bg-white border border-slate-300 rounded-lg shadow-sm">
                <p className="text-sm text-slate-600 font-semibold">Include Hours:</p>
                <label className="flex items-center text-sm text-slate-500">
                  <input type="checkbox" checked={filters.env} onChange={(e) => setFilters({ ...filters, env: e.target.checked })} className="form-checkbox text-indigo-600 rounded-sm mr-1" />
                  [ENV]
                </label>
                <label className="flex items-center text-sm text-slate-500">
                  <input type="checkbox" checked={filters.pnb} onChange={(e) => setFilters({ ...filters, pnb: e.target.checked })} className="form-checkbox text-indigo-600 rounded-sm mr-1" />
                  [PNB]
                </label>
              </div>

              <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded-lg ml-auto">
                <Info className="w-5 h-5 text-blue-500" />
                <p className="text-sm text-blue-700">
                  {filterMode === 'month' ? `Displaying data for ${selectedDepartment} in ${selectedMonth}.` :
                    (startDate && endDate ? `Displaying data for ${selectedDepartment} from ${startDate} to ${endDate}.` : `Select a date range to filter.`)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
            <StatCard icon={<Target className="w-6 h-6 text-green-800"/>} title="Overall % of Target" value={`${analysis.overall.utilization.toFixed(1)}%`} subtext={`Booked Billable / Required Billable`} color="bg-green-200" />
            <StatCard icon={<Users className="w-6 h-6 text-indigo-800"/>} title="Active Resources" value={analysis.overall.employeeCount} subtext="Employees with allocated hours" color="bg-indigo-200" />
            <StatCard icon={<Clock className="w-6 h-6 text-amber-800"/>} title="Total Hours Booked" value={analysis.overall.totalBookedHours.toLocaleString(undefined, {maximumFractionDigits: 0})} subtext="Excludes PTO & INT" color="bg-amber-200" />
            <StatCard icon={<TrendingUp className="w-6 h-6 text-sky-800"/>} title="Total Billable Hours Available" value={analysis.overall.requiredBillableHours.toLocaleString(undefined, {maximumFractionDigits: 0})} subtext={`Based on ${analysis.totalBusinessDaysInScope} business days`} color="bg-sky-200" />
          </div>

          <div className="grid grid-cols-1 gap-8">
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
                        <button onClick={() => requestSort('requiredBillableHours')} className="flex items-center w-full justify-end text-right">Required Hrs {getSortIcon('requiredBillableHours')}</button>
                      </th>
                      <th className="p-3 text-sm font-semibold text-slate-500 text-right w-24">
                        <button onClick={() => requestSort('totalBookedHours')} className="flex items-center w-full justify-end">Hrs Booked {getSortIcon('totalBookedHours')}</button>
                      </th>
                      <th className="p-3 text-sm font-semibold text-slate-500 text-right w-24">
                        <button onClick={() => requestSort('utilizationPercent')} className="flex items-center w-full justify-end">Utilization % {getSortIcon('utilizationPercent')}</button>
                      </th>
                      <th className="p-3 text-sm font-semibold text-slate-500 text-right w-24">
                        <button onClick={() => requestSort('targetPercentDisplay')} className="flex items-center w-full justify-end">Target % {getSortIcon('targetPercentDisplay')}</button>
                      </th>
                      <th className="p-3 text-sm font-semibold text-slate-500 text-right w-36">
                        <button onClick={() => requestSort('percentToTarget')} className="flex items-center w-full justify-end">% of Target {getSortIcon('percentToTarget')}</button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEmployees.map(e => (
                      <tr key={e.nameForDisplay}
                          onClick={() => setActiveEmployee(e)}
                          className={`hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-b-0 ${e.bookedBillable < 1 ? 'text-slate-400' : ''}`}>
                        <td className="p-3 font-semibold">{e.nameForDisplay} <span className="block text-xs font-normal text-slate-400">{e.title}</span></td>
                        <td className="p-3">{e.department}</td>
                        <td className="p-3 text-right font-medium">{e.requiredBillableHours.toFixed(1)}</td>
                        <td className="p-3 text-right">{e.totalBookedHours.toFixed(0)}</td>
                        <td className="p-3 text-right">{e.utilizationPercent.toFixed(1)}%</td>
                        <td className="p-3 text-right">{e.targetPercentDisplay.toFixed(0)}%</td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className={`font-bold ${e.bookedBillable < 1 ? '' : 'text-indigo-600'}`}>{e.percentToTarget.toFixed(1)}%</span>
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
                <p className="text-xs text-slate-500">Required Hrs</p>
                <p className="text-xl font-bold">{activeEmployee.requiredBillableHours.toFixed(1)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Booked Billable</p>
                <p className={`text-xl font-bold ${activeEmployee.bookedBillable < 1 ? 'text-slate-400' : ''}`}>{activeEmployee.bookedBillable.toFixed(1)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Target %</p>
                <p className="text-xl font-bold">{activeEmployee.targetPercentDisplay.toFixed(0)}%</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">% of Target</p>
                <p className="text-xl font-bold text-indigo-600">{activeEmployee.percentToTarget.toFixed(1)}%</p>
              </div>
            </div>

            {/* PTO / INT summary next to Booked Billable */}
            <div className="grid grid-cols-2 md:grid-cols-2 gap-4 -mt-2 mb-6 text-center">
              <div>
                <p className="text-xs text-slate-500">PTO (Not Billable)</p>
                <p className="text-lg font-semibold">{activeEmployee.ptoHours.toFixed(1)} hrs</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">INT (Not Billable)</p>
                <p className="text-lg font-semibold">{activeEmployee.intHours.toFixed(1)} hrs</p>
              </div>
            </div>

            <h3 className="font-semibold text-lg mb-2">Project Breakdown for {filterMode === 'month' ? selectedMonth : `${startDate} to ${endDate}`}</h3>
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
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${p.isBillable ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{p.isBillable ? 'Billable' : 'Not Billable'}</span>
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
