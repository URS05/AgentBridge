import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type NodeProps,
  type Node,
  type Edge,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { JourneyStage } from '../../core/types';
import { HUMAN_STAGE_LABELS, humanizeStatus } from '../humanCopy';
import { StatusBadge } from './StatusBadge';

interface StageNodeData extends Record<string, unknown> {
  stage: JourneyStage;
  selected: boolean;
  onSelect: (stageId: string) => void;
}

function StageNode({ data }: NodeProps<Node<StageNodeData>>) {
  const { stage, selected, onSelect } = data;
  const isBlocked = stage.status === 'BLOCKED' || stage.status === 'MISMATCH';
  const isVerified = stage.status === 'VERIFIED' || stage.status === 'COMPLETED';
  const isNeedsHuman = stage.status === 'NEEDS_HUMAN';

  const borderClass = selected
    ? 'border-primary ring-2 ring-primary/25'
    : isBlocked
      ? 'border-destructive/60'
      : isNeedsHuman
        ? 'border-[#D97706]/60'
        : isVerified
          ? 'border-[#16A34A]/50'
          : 'border-border';

  return (
    <button
      type="button"
      onClick={() => onSelect(stage.id)}
      className={`w-[260px] text-left rounded-xl bg-card border ${borderClass} p-3.5 transition-colors hover:bg-secondary/50 focus:outline-none shadow-xs`}
    >
      <Handle type="target" position={Position.Left} className="!bg-border !w-2 !h-2 !border-0" />
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-medium text-muted-foreground">Step {stage.order}</span>
        <StatusBadge status={stage.status} />
      </div>
      <div className="text-sm font-semibold text-foreground truncate">
        {HUMAN_STAGE_LABELS[stage.stageName] ?? stage.label}
      </div>
      <div className="text-xs text-muted-foreground truncate mt-0.5">{stage.agentName}</div>

      <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between gap-2 text-[11px] text-muted-foreground whitespace-nowrap">
        <span>Check: {humanizeStatus(stage.validationStatus)}</span>
        <span className="tabular-nums">
          Retries: {stage.retryCount}
          {stage.latencyMs !== null ? ` · ${stage.latencyMs}ms` : ''}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border !w-2 !h-2 !border-0" />
    </button>
  );
}

const nodeTypes = { stageNode: StageNode };

export function JourneyDag({
  stages,
  selectedStageId,
  onSelectStage,
}: {
  stages: JourneyStage[];
  selectedStageId: string | null;
  onSelectStage: (stageId: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const sorted = [...stages].sort((a, b) => a.order - b.order);

    const builtNodes: Node<StageNodeData>[] = sorted.map((stage, idx) => ({
      id: stage.id,
      type: 'stageNode',
      position: { x: idx * 310, y: 36 },
      data: {
        stage,
        selected: selectedStageId === stage.id,
        onSelect: onSelectStage,
      },
      draggable: false,
    }));

    const builtEdges: Edge[] = sorted.slice(0, -1).map((stage, idx) => {
      const next = sorted[idx + 1];
      const upstreamVerified = stage.status === 'VERIFIED' || stage.status === 'COMPLETED';
      const blocked = stage.status === 'BLOCKED' || stage.status === 'MISMATCH' || stage.status === 'NEEDS_HUMAN';
      const stroke = upstreamVerified
        ? '#16A34A'
        : blocked
          ? '#DC2626'
          : '#94A3B8';

      return {
        id: `e_${stage.id}_${next.id}`,
        source: stage.id,
        target: next.id,
        animated: stage.status === 'RUNNING' || stage.status === 'VERIFYING',
        style: { stroke, strokeWidth: 2, strokeDasharray: blocked ? '5 4' : undefined },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
      };
    });

    return { nodes: builtNodes, edges: builtEdges };
  }, [stages, selectedStageId, onSelectStage]);

  return (
    <div
      className="h-[240px] w-full rounded-xl border border-border bg-background overflow-hidden"
      data-testid="journey-dag"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
      >
        <Background color="var(--border)" gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
