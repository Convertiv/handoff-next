import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Button } from '../../ui/button';
import { Film, Trash2Icon } from 'lucide-react';
import { useEditContext } from '../EditContext';

export function VideoFileField({ identifier, value }: { identifier: string[]; value: any; data: any }) {
  const { getData, handleInputChange } = useEditContext();
  const videoData = getData(identifier);
  const hasSrc = !!videoData?.url;

  return (
    <div className="space-y-2 rounded-lg">
      {hasSrc && (
        <div className="flex items-center justify-center overflow-hidden rounded-lg bg-muted">
          <video
            src={videoData.url}
            controls
            className="max-h-40 w-full object-contain"
            onError={(e) => {
              (e.currentTarget as HTMLVideoElement).style.display = 'none';
            }}
          />
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor={`${identifier[identifier.length - 1]}_url`} className="text-xs">
          Video URL
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id={`${identifier[identifier.length - 1]}_url`}
            placeholder="https://example.com/video.mp4"
            defaultValue={videoData?.url || ''}
            onChange={(e) => handleInputChange([...identifier, 'url'], e.target.value)}
          />
          {hasSrc && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => handleInputChange([...identifier, 'url'], '')}
            >
              <Trash2Icon className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`${identifier[identifier.length - 1]}_title`} className="text-xs">
          Title
        </Label>
        <Input
          id={`${identifier[identifier.length - 1]}_title`}
          placeholder="Video title"
          defaultValue={videoData?.title || ''}
          onChange={(e) => handleInputChange([...identifier, 'title'], e.target.value)}
        />
      </div>

      {value.description && <p className="text-xs text-muted-foreground">{value.description}</p>}
    </div>
  );
}
