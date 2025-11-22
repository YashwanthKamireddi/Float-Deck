import pathlib 
lines=pathlib.Path('src/components/DataVisualization.tsx').read_text().splitlines() 
\nfor i,l in enumerate(lines): 
    if 'metricValues' in l and 'useMemo' in l: 
        s=max(0,i-5); e=min(len(lines), i+20) 
        print('\n'.join(f'{j+1:04d}: {lines[j]}' for j in range(s,e))) 
        break 
